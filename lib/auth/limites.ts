/**
 * VEKTORA · FASE 8 — Límite de intentos de acceso y de altas (lógica pura, sin Next).
 *
 * BCrypt hace lento CADA intento, pero no limita cuántos: sin esto se podía probar
 * contraseñas contra una cuenta sin freno, y crear cuentas descartables sin freno.
 *
 * Qué se cuenta y con qué clave:
 *
 *   · inicio de sesión — solo los FALLOS, en tres cubos:
 *       correo + IP   5 fallos / 15 min  el límite que de verdad frena la fuerza bruta;
 *       correo       50 fallos / 15 min  respaldo: la IP se puede falsificar (ver abajo);
 *       IP          100 fallos / 15 min  holgado: un aula o el wifi de URUCON son UNA IP.
 *     Un acceso correcto borra solo el cubo correo+IP. Si borrara también el de la IP,
 *     quien tiene una cuenta válida podría reiniciarlo entre intento e intento.
 *   · alta de cuenta — las altas que se completan, 20 por hora y por IP.
 *
 * Tres decisiones que importan:
 *
 *   1. Se aplica IGUAL exista o no el correo. Contar distinto delataría qué correos están
 *      registrados, justo lo que el mensaje único de credenciales existe para impedir.
 *   2. Nunca hace falta una persona para desbloquear: la ventana es deslizante y cada fallo
 *      vence solo a los 15 minutos.
 *   3. No hay bloqueo por correo solo con un tope bajo. Las cuentas demo tienen una
 *      contraseña pública: cualquiera podría dejar sin acceso a `cliente@vektora.test`
 *      justo antes de la defensa. Por eso el correo solo tiene un tope alto (50).
 *
 * La IP sale de `x-forwarded-for` (ver `ipDeCabeceras`). En Render el proxy AGREGA al valor
 * que manda el cliente en vez de reemplazarlo, así que la IP se puede falsificar: por eso
 * el cubo correo+IP no alcanza solo y existe el respaldo por correo.
 *
 * Los contadores viven en memoria del proceso. Hay una sola instancia (Render gratis,
 * réplica única en minikube), así que alcanza; un reinicio los pone en cero, que solo le da
 * al atacante una ventana nueva de 15 minutos. Los límites NO están medidos: no hay
 * historial de ataques del que derivarlos.
 */

export interface Regla {
  maximo: number;
  ventanaMs: number;
}

export interface PoliticaAcceso {
  correoIp: Regla;
  correo: Regla;
  ip: Regla;
  altaIp: Regla;
  /** Tope de claves en memoria: un atacante que rota IP falsas no puede agotar la RAM. */
  maxClaves: number;
}

const QUINCE_MINUTOS = 15 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;

export const POLITICA_ACCESO: PoliticaAcceso = {
  correoIp: { maximo: 5, ventanaMs: QUINCE_MINUTOS },
  correo: { maximo: 50, ventanaMs: QUINCE_MINUTOS },
  ip: { maximo: 100, ventanaMs: QUINCE_MINUTOS },
  altaIp: { maximo: 20, ventanaMs: UNA_HORA },
  maxClaves: 10_000,
};

export interface Bloqueo {
  /** Milisegundos hasta que vence el intento más viejo del cubo que bloquea. */
  esperaMs: number;
}

/** Contador de eventos por clave en ventana deslizante, con tope de memoria. */
export class VentanaDeslizante {
  private readonly eventos = new Map<string, number[]>();

  constructor(
    private readonly maxClaves: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  /** Si la clave llegó al máximo, cuánto falta para que se libere un lugar. */
  bloqueo(clave: string, regla: Regla): Bloqueo | null {
    const vigentes = this.vigentes(clave, regla.ventanaMs);
    if (vigentes.length < regla.maximo) return null;
    const masViejo = vigentes[vigentes.length - regla.maximo] ?? this.ahora();
    return { esperaMs: Math.max(0, masViejo + regla.ventanaMs - this.ahora()) };
  }

  registrar(clave: string, regla: Regla): void {
    const vigentes = this.vigentes(clave, regla.ventanaMs);
    vigentes.push(this.ahora());
    // Reinsertar mueve la clave al final del orden del Map: las más viejas quedan primero.
    this.eventos.delete(clave);
    this.eventos.set(clave, vigentes);
    this.podar(regla.ventanaMs);
  }

  borrar(clave: string): void {
    this.eventos.delete(clave);
  }

  get tamano(): number {
    return this.eventos.size;
  }

  private vigentes(clave: string, ventanaMs: number): number[] {
    const desde = this.ahora() - ventanaMs;
    return (this.eventos.get(clave) ?? []).filter((t) => t > desde);
  }

  /** Por encima del tope se tira primero lo vencido y después lo más viejo. */
  private podar(ventanaMs: number): void {
    if (this.eventos.size <= this.maxClaves) return;
    const desde = this.ahora() - ventanaMs;
    for (const [clave, tiempos] of this.eventos) {
      if (!tiempos.some((t) => t > desde)) this.eventos.delete(clave);
    }
    for (const clave of this.eventos.keys()) {
      if (this.eventos.size <= this.maxClaves) break;
      this.eventos.delete(clave);
    }
  }
}

/** Minutos legibles para el mensaje: siempre al menos 1. */
export function minutosDe(esperaMs: number): number {
  return Math.max(1, Math.ceil(esperaMs / 60_000));
}

/**
 * Límite de intentos de acceso y de altas. Lo usa `AuthService`; un proceso tiene uno solo
 * (`getLimitadorAcceso`), así el conteo se comparte entre peticiones.
 */
export class LimitadorAcceso {
  private readonly fallos: VentanaDeslizante;
  private readonly altas: VentanaDeslizante;

  constructor(
    private readonly politica: PoliticaAcceso = POLITICA_ACCESO,
    ahora: () => number = Date.now,
  ) {
    this.fallos = new VentanaDeslizante(politica.maxClaves, ahora);
    this.altas = new VentanaDeslizante(politica.maxClaves, ahora);
  }

  /** El bloqueo más largo de los cubos de acceso que aplican, o `null` si puede intentar. */
  bloqueoDeAcceso(correo: string, ip: string | null): Bloqueo | null {
    return mayor(
      this.cubosDeAcceso(correo, ip).map(([clave, regla]) => this.fallos.bloqueo(clave, regla)),
    );
  }

  registrarFallo(correo: string, ip: string | null): void {
    for (const [clave, regla] of this.cubosDeAcceso(correo, ip)) this.fallos.registrar(clave, regla);
  }

  /** Acceso correcto: se borra SOLO el cubo correo+IP (ver la cabecera del módulo). */
  registrarExito(correo: string, ip: string | null): void {
    this.fallos.borrar(claveCorreoIp(correo, ip));
  }

  /** Sin IP conocida no se limita el alta: no hay con qué distinguir a una persona de otra. */
  bloqueoDeAlta(ip: string | null): Bloqueo | null {
    return ip === null ? null : this.altas.bloqueo(`alta:${ip}`, this.politica.altaIp);
  }

  registrarAlta(ip: string | null): void {
    if (ip !== null) this.altas.registrar(`alta:${ip}`, this.politica.altaIp);
  }

  private cubosDeAcceso(correo: string, ip: string | null): Array<[string, Regla]> {
    const cubos: Array<[string, Regla]> = [
      [claveCorreoIp(correo, ip), this.politica.correoIp],
      [`correo:${correo}`, this.politica.correo],
    ];
    if (ip !== null) cubos.push([`ip:${ip}`, this.politica.ip]);
    return cubos;
  }
}

function claveCorreoIp(correo: string, ip: string | null): string {
  return `par:${correo}|${ip ?? 'sin-ip'}`;
}

function mayor(bloqueos: Array<Bloqueo | null>): Bloqueo | null {
  let peor: Bloqueo | null = null;
  for (const bloqueo of bloqueos) {
    if (bloqueo !== null && (peor === null || bloqueo.esperaMs > peor.esperaMs)) peor = bloqueo;
  }
  return peor;
}

/**
 * IP de quien hace la petición, o `null` si no hay una utilizable.
 *
 * Se toma la PRIMERA entrada de `x-forwarded-for`. Puede ser falsificada (el proxy de
 * Render agrega al valor del cliente en lugar de reemplazarlo), y aun así es la opción
 * segura: la última entrada podría ser la IP del propio proxy, igual para todo el mundo, y
 * entonces el cubo por IP se volvería un candado GLOBAL que deja a todos sin entrar.
 * Falsificar la primera solo esquiva los cubos con IP; el respaldo por correo sigue.
 *
 * Sin proxy (compose, minikube) Next completa la cabecera con la dirección del socket.
 */
export function ipDeCabeceras(cabeceras: { get(nombre: string): string | null }): string | null {
  const reenviada = cabeceras.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const candidata = reenviada !== '' ? reenviada : (cabeceras.get('x-real-ip')?.trim() ?? '');
  // Una IP (v4 o v6, con puerto o zona) no pasa de 64 caracteres ni trae otra cosa.
  if (candidata === '' || candidata.length > 64 || !/^[0-9a-fA-F.:%[\]]+$/.test(candidata)) {
    return null;
  }
  return candidata.toLowerCase();
}

let compartido: LimitadorAcceso | null = null;

/** El limitador del proceso: todas las peticiones tienen que ver los mismos contadores. */
export function getLimitadorAcceso(): LimitadorAcceso {
  if (compartido === null) compartido = new LimitadorAcceso();
  return compartido;
}
