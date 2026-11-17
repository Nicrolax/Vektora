'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { presentarQa, presentarTarea } from '@/components/estados';
import { ALTO_NODO, ANCHO_NODO, disponerGrafo, type TareaGrafo } from '@/components/grafo/disposicion';
import { Insignia } from '@/components/ui/primitivas';

/**
 * Las piezas que se mueven en la presentación pública.
 *
 * No son capturas ni videos: son recreaciones con los MISMOS módulos que usa el producto
 * (la disposición del grafo, los colores y nombres de estado). Si mañana cambia cómo se ve
 * un estado en la app, cambia también acá. Los casos son de ejemplo y lo dicen.
 *
 * `MotionConfig reducedMotion="user"`: quien pidió menos movimiento no ve desplazamientos;
 * los componentes que animan por su cuenta (grafo, palabras) además se quedan quietos.
 */

const EASE = [0.22, 1, 0.36, 1] as const; // la misma curva que --ease-suave

export function Movimiento({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Entra una sola vez al aparecer en pantalla. */
export function Revelar({
  children,
  className,
  retraso = 0,
}: {
  children: React.ReactNode;
  className?: string;
  retraso?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.26, delay: retraso, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------------------------- */
/* Grafo vivo                                                                            */
/* ------------------------------------------------------------------------------------- */

const PROYECTO: TareaGrafo[] = [
  { id: 't1', code: 'T1', title: 'Relevar productos y precios', dependsOn: [] },
  { id: 't2', code: 'T2', title: 'Identidad visual', dependsOn: ['T1'] },
  { id: 't3', code: 'T3', title: 'Catálogo con fotos', dependsOn: ['T1'] },
  { id: 't4', code: 'T4', title: 'Diseño de la tienda', dependsOn: ['T2', 'T3'] },
  { id: 't5', code: 'T5', title: 'Cobro con Mercado Pago', dependsOn: ['T3'] },
  { id: 't6', code: 'T6', title: 'Puesta en línea', dependsOn: ['T4', 'T5'] },
].map((t) => ({ ...t, status: 'blocked', assigneeId: null, budget: null }));

// Recorrido de cada tarea una vez desbloqueada. T4 pasa por un pedido de cambios: así se
// ve que una entrega incompleta no se rechaza de una, se devuelve.
const NORMAL = ['ready', 'matching', 'assigned', 'submitted', 'approved'];
const RECORRIDO: Record<string, string[]> = {
  T4: ['ready', 'matching', 'assigned', 'submitted', 'revision_requested', 'submitted', 'approved'],
};

/** Estado de cada tarea en el instante `tic`, respetando las dependencias reales. */
function simular(tic: number): Map<string, string> {
  const aprobadaEn = new Map<string, number>();
  const estados = new Map<string, string>();
  for (const tarea of PROYECTO) {
    const desbloqueo = Math.max(0, ...tarea.dependsOn.map((d) => aprobadaEn.get(d) ?? 0));
    const pasos = RECORRIDO[tarea.code] ?? NORMAL;
    aprobadaEn.set(tarea.code, desbloqueo + pasos.length);
    const i = tic - desbloqueo;
    estados.set(tarea.code, i < 0 ? 'blocked' : (pasos[Math.min(i, pasos.length - 1)] ?? 'approved'));
  }
  return estados;
}

const TICS = 24; // 21 hasta que todo se aprueba, más una pausa para verlo terminado
const TIC_QUIETO = 9; // con movimiento reducido: un instante con varios estados a la vez

export function GrafoVivo() {
  const reducir = useReducedMotion();
  const caja = useRef<HTMLDivElement>(null);
  const visible = useInView(caja, { amount: 0.4 });
  const [tic, setTic] = useState(0);
  const [foco, setFoco] = useState<string | null>(null);

  useEffect(() => {
    if (reducir || !visible) return;
    const reloj = setInterval(() => setTic((t) => (t + 1) % TICS), 850);
    return () => clearInterval(reloj);
  }, [reducir, visible]);

  const estados = simular(reducir ? TIC_QUIETO : tic);
  const tareas = PROYECTO.map((t) => ({ ...t, status: estados.get(t.code) ?? 'blocked' }));
  const disposicion = disponerGrafo(tareas);
  const enfocada = tareas.find((t) => t.code === foco);
  const aprobadas = tareas.filter((t) => t.status === 'approved').length;

  return (
    <div ref={caja} className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-[var(--color-borde)] bg-[var(--color-lienzo-alto)]/70 backdrop-blur-sm">
        <svg
          role="img"
          aria-label="Ejemplo: un proyecto de seis tareas avanzando solo, de bloqueada a aprobada"
          viewBox={`0 0 ${disposicion.ancho} ${disposicion.alto}`}
          className="block w-full min-w-[640px]"
        >
          {disposicion.aristas.map((arista) => (
            <g key={`${arista.desde}-${arista.hasta}`}>
              <path
                d={arista.trazo}
                fill="none"
                stroke="var(--color-borde)"
                strokeWidth={1.2}
                strokeDasharray="4 4"
                opacity={0.6}
              />
              <motion.path
                d={arista.trazo}
                fill="none"
                stroke="var(--color-aprobada)"
                strokeWidth={1.8}
                initial={false}
                animate={{ pathLength: arista.satisfecha ? 1 : 0, opacity: arista.satisfecha ? 0.9 : 0 }}
                transition={{ duration: 0.26, ease: EASE }}
              />
            </g>
          ))}
          {disposicion.nodos.map((nodo) => {
            const { color, etiqueta } = presentarTarea(nodo.status);
            const activo = foco === nodo.code;
            return (
              <g
                key={nodo.id}
                transform={`translate(${nodo.x} ${nodo.y})`}
                tabIndex={0}
                aria-label={`${nodo.code}: ${nodo.title}. ${etiqueta}`}
                className="cursor-default outline-none"
                onPointerEnter={() => setFoco(nodo.code)}
                onPointerLeave={() => setFoco(null)}
                onFocus={() => setFoco(nodo.code)}
                onBlur={() => setFoco(null)}
              >
                <rect
                  width={ANCHO_NODO}
                  height={ALTO_NODO}
                  rx={12}
                  fill={activo ? 'var(--color-panel-alto)' : 'var(--color-panel)'}
                  stroke={activo ? color : 'var(--color-borde)'}
                  style={{ transition: 'fill 200ms var(--ease-suave), stroke 200ms var(--ease-suave)' }}
                />
                <rect
                  x={0}
                  y={10}
                  width={3}
                  height={ALTO_NODO - 20}
                  rx={2}
                  fill={color}
                  style={{ transition: 'fill 200ms var(--ease-suave)' }}
                />
                <text x={16} y={24} className="fill-[var(--color-apagado)] font-mono text-[11px]">
                  {nodo.code}
                </text>
                <text x={16} y={44} className="fill-[var(--color-texto)] text-[13px]">
                  {nodo.title}
                </text>
                <text
                  x={16}
                  y={58}
                  className="text-[10px]"
                  fill={color}
                  style={{ transition: 'fill 200ms var(--ease-suave)' }}
                >
                  {etiqueta}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p
        className="flex min-h-7 flex-wrap items-center gap-2 text-xs text-[var(--color-apagado)]"
        aria-live="polite"
      >
        {enfocada !== undefined ? (
          <>
            <Insignia estado={enfocada.status} />
            <span>{presentarTarea(enfocada.status).ayuda}</span>
          </>
        ) : (
          <span>
            Ejemplo: tienda online para una panadería. {aprobadas} de {tareas.length} tareas aprobadas. Pasá
            el cursor por una tarea para ver qué espera.
          </span>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- */
/* El ciclo: cuatro pasos fijados al scroll                                               */
/* ------------------------------------------------------------------------------------- */

const PASOS = [
  {
    titulo: 'Planifica',
    texto:
      'Tu objetivo se convierte en un grafo de tareas con dependencias, presupuesto y criterios que se pueden verificar.',
  },
  {
    titulo: 'Adjudica',
    texto:
      'Cada tarea va a quien mejor encaja: parecido semántico, habilidades y reputación, con la cuenta a la vista.',
  },
  {
    titulo: 'Recibe',
    texto:
      'El proveedor entrega contra los criterios de aceptación y dentro de un plazo. Si no entrega, la tarea vuelve al mercado.',
  },
  {
    titulo: 'Juzga',
    texto:
      'Un juez de IA revisa criterio por criterio citando la evidencia. Aprobar desbloquea lo que sigue.',
  },
] as const;

export function Ciclo({ encabezado }: { encabezado: React.ReactNode }) {
  const pista = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: pista, offset: ['start start', 'end end'] });
  const [paso, setPaso] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    setPaso(Math.min(PASOS.length - 1, Math.floor(p * PASOS.length)));
  });

  return (
    <>
      {/* Escritorio: el escenario queda fijo y el scroll avanza el paso. */}
      <div ref={pista} className="relative hidden lg:block" style={{ height: `${PASOS.length * 65}vh` }}>
        <div className="sticky top-16 grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-start gap-16 pt-10">
          <div className="space-y-8">
            {encabezado}
            <ol className="space-y-1">
              {PASOS.map((p, i) => (
                <li key={p.titulo}>
                  <motion.div
                    className="relative rounded-2xl py-3 pr-4 pl-6"
                    animate={{ opacity: i === paso ? 1 : 0.38 }}
                    transition={{ duration: 0.24, ease: EASE }}
                  >
                    <motion.span
                      aria-hidden
                      className="degradado-marca absolute top-4 bottom-4 left-0 w-[3px] origin-top rounded-full"
                      animate={{ scaleY: i === paso ? 1 : 0 }}
                      transition={{ duration: 0.24, ease: EASE }}
                    />
                    <h3 className="text-2xl font-semibold">{p.titulo}</h3>
                    <p className="mt-1.5 max-w-md text-[0.95rem] leading-relaxed text-[var(--color-tenue)]">
                      {p.texto}
                    </p>
                  </motion.div>
                </li>
              ))}
            </ol>
          </div>
          <div className="relative min-h-[27rem]">
            <AnimatePresence mode="wait">
              <motion.div
                key={paso}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22, ease: EASE }}
              >
                <Escena paso={paso} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Móvil y tablet: los pasos apilados, cada escena entra al llegar. */}
      <div className="space-y-10 lg:hidden">
        <Revelar>{encabezado}</Revelar>
        <ol className="space-y-14">
          {PASOS.map((p, i) => (
            <li key={p.titulo} className="space-y-5">
              <Revelar>
                <h3 className="text-2xl font-semibold">{p.titulo}</h3>
                <p className="mt-1.5 text-[0.95rem] leading-relaxed text-[var(--color-tenue)]">{p.texto}</p>
              </Revelar>
              <Revelar retraso={0.06}>
                <Escena paso={i} />
              </Revelar>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

function Escena({ paso }: { paso: number }) {
  if (paso === 0) return <EscenaPlan />;
  if (paso === 1) return <EscenaAdjudicacion />;
  if (paso === 2) return <EscenaEntrega />;
  return <EscenaJuez />;
}

/** Hijos que entran en cascada cuando la escena aparece. */
const cascada = {
  oculto: {},
  visible: { transition: { staggerChildren: 0.07 } },
};
const pieza = {
  oculto: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } },
};

function Lienzo({ children, pie }: { children: React.ReactNode; pie: string }) {
  return (
    <figure className="space-y-3">
      <motion.div
        className="tarjeta space-y-4 p-5 sm:p-6"
        variants={cascada}
        initial="oculto"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        {children}
      </motion.div>
      <figcaption className="text-xs leading-relaxed text-[var(--color-apagado)]">{pie}</figcaption>
    </figure>
  );
}

function Tilde({ ok = true }: { ok?: boolean }) {
  return (
    <span
      aria-hidden
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold"
      style={{
        color: ok ? 'var(--color-aprobada)' : 'var(--color-revision)',
        backgroundColor: `color-mix(in oklch, ${ok ? 'var(--color-aprobada)' : 'var(--color-revision)'} 16%, transparent)`,
      }}
    >
      {ok ? '✓' : '?'}
    </span>
  );
}

function EscenaPlan() {
  const tareas = PROYECTO.slice(0, 4);
  return (
    <Lienzo pie="Las tres comprobaciones son refinamientos de Zod: si el modelo propone algo que no las cumple, se le devuelve el error y corrige.">
      <motion.div
        variants={pieza}
        className="rounded-xl border border-[var(--color-borde)] bg-[var(--color-lienzo-alto)] px-4 py-3"
      >
        <p className="text-xs text-[var(--color-apagado)]">Objetivo</p>
        <p className="mt-1 text-[0.95rem]">
          Quiero vender online los productos de mi panadería. Presupuesto: US$ 1.200.
        </p>
      </motion.div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {tareas.map((t) => (
          <motion.li
            key={t.code}
            variants={pieza}
            className="flex items-baseline gap-3 rounded-xl bg-[var(--color-panel-alto)] px-3.5 py-2.5 text-sm"
          >
            <span className="font-mono text-xs text-[var(--color-apagado)]">{t.code}</span>
            <span className="min-w-0 truncate">{t.title}</span>
          </motion.li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-sm text-[var(--color-tenue)]">
        {['Sin ciclos', 'El presupuesto suma exacto', 'Ningún criterio pide una firma'].map((c) => (
          <motion.span key={c} variants={pieza} className="inline-flex items-center gap-2">
            <Tilde />
            {c}
          </motion.span>
        ))}
      </div>
    </Lienzo>
  );
}

// Pesos y umbral reales (lib/matching/config.ts). Los candidatos y sus valores son de ejemplo.
const PESOS = { vector: 0.45, skill: 0.35, reputacion: 0.2 };
const UMBRAL = 0.5;
const CANDIDATOS = [
  { nombre: 'Lucía Ferreira', vector: 0.82, skill: 0.9, reputacion: 0.71 },
  { nombre: 'Martín Olivera', vector: 0.64, skill: 0.75, reputacion: 0.5 },
  { nombre: 'Agustina Pereyra', vector: 0.41, skill: 0.5, reputacion: 0.5 },
];

function EscenaAdjudicacion() {
  return (
    <Lienzo pie="Pesos y umbral reales del motor de emparejamiento; candidatos de ejemplo. Si nadie llega al umbral, se vuelve a intentar y, tras cuatro rondas, se escala.">
      <motion.div variants={pieza} className="flex items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-mono text-xs text-[var(--color-apagado)]">T3</span> Catálogo con fotos
        </p>
        <span className="text-xs text-[var(--color-apagado)]">umbral {UMBRAL.toFixed(2)}</span>
      </motion.div>
      <ul className="space-y-4">
        {CANDIDATOS.map((c, i) => {
          const partes = [
            { valor: PESOS.vector * c.vector, color: 'var(--color-acento)', nombre: 'parecido' },
            { valor: PESOS.skill * c.skill, color: 'var(--color-acento-claro)', nombre: 'habilidades' },
            {
              valor: PESOS.reputacion * c.reputacion,
              color: 'var(--color-acento-fin)',
              nombre: 'reputación',
            },
          ];
          const total = partes.reduce((s, p) => s + p.valor, 0);
          return (
            <motion.li key={c.nombre} variants={pieza} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className={i === 0 ? '' : 'text-[var(--color-tenue)]'}>{c.nombre}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono tabular-nums">{total.toFixed(2)}</span>
                  {i === 0 && <Insignia estado="assigned" />}
                </span>
              </div>
              <div className="relative flex h-2 gap-0.5" aria-hidden>
                {partes.map((p) => (
                  <motion.span
                    key={p.nombre}
                    className="h-full origin-left rounded-full"
                    style={{
                      width: `${p.valor * 100}%`,
                      backgroundColor: p.color,
                      opacity: i === 0 ? 1 : 0.55,
                    }}
                    variants={{
                      oculto: { scaleX: 0 },
                      visible: { scaleX: 1, transition: { duration: 0.26, ease: EASE } },
                    }}
                  />
                ))}
                <span
                  className="absolute -top-1 -bottom-1 w-px bg-[var(--color-texto)]/60"
                  style={{ left: `${UMBRAL * 100}%` }}
                />
              </div>
            </motion.li>
          );
        })}
      </ul>
      <motion.p
        variants={pieza}
        className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-apagado)]"
      >
        <Leyenda color="var(--color-acento)">parecido semántico {PESOS.vector}</Leyenda>
        <Leyenda color="var(--color-acento-claro)">habilidades {PESOS.skill}</Leyenda>
        <Leyenda color="var(--color-acento-fin)">reputación {PESOS.reputacion}</Leyenda>
      </motion.p>
    </Lienzo>
  );
}

function Leyenda({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

const CRITERIOS = [
  {
    id: 'C1',
    texto: 'Cada producto tiene foto, nombre y precio',
    evidencia: 'catalogo.md, 42 productos con los tres campos',
  },
  {
    id: 'C2',
    texto: 'Las fotos miden al menos 1200 px de ancho',
    evidencia: 'tabla de imágenes con sus dimensiones',
  },
  {
    id: 'C3',
    texto: 'Los precios coinciden con el relevamiento de T1',
    evidencia: 'falta la tabla comparativa',
  },
];

function EscenaEntrega() {
  return (
    <Lienzo pie="Plazo de ejemplo. Una tarea adjudicada que nadie entrega no queda esperando: vence y vuelve al mercado.">
      <motion.div variants={pieza} className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-mono text-xs text-[var(--color-apagado)]">T3</span> entrega de Lucía Ferreira
        </p>
        <Insignia estado="submitted" />
      </motion.div>
      <ul className="space-y-2.5">
        {CRITERIOS.map((c) => (
          <motion.li
            key={c.id}
            variants={pieza}
            className="rounded-xl bg-[var(--color-panel-alto)] px-4 py-3"
          >
            <p className="text-sm">
              <span className="mr-2 font-mono text-xs text-[var(--color-apagado)]">{c.id}</span>
              {c.texto}
            </p>
            <p className="mt-1 text-xs text-[var(--color-tenue)]">Evidencia: {c.evidencia}</p>
          </motion.li>
        ))}
      </ul>
      <motion.p variants={pieza} className="text-xs text-[var(--color-apagado)]">
        Entregado a las 31 h de un plazo de 48 h.
      </motion.p>
    </Lienzo>
  );
}

function EscenaJuez() {
  const [intento, setIntento] = useState<1 | 2>(1);
  const resultados = intento === 1 ? [true, true, false] : [true, true, true];
  const veredicto = intento === 1 ? 'revision_requested' : 'approved';
  const { etiqueta, color } = presentarQa(veredicto);

  return (
    <Lienzo pie="Reglas reales del juez: se aprueba solo si se cumple todo, si falta evidencia se pide, y un primer intento nunca se rechaza.">
      <motion.div variants={pieza} className="flex items-center justify-between gap-3">
        <div
          className="inline-flex rounded-xl border border-[var(--color-borde)] p-1"
          role="group"
          aria-label="Intento"
        >
          {([1, 2] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setIntento(n)}
              aria-pressed={intento === n}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200"
              style={{
                backgroundColor: intento === n ? 'var(--color-panel-alto)' : 'transparent',
                color: intento === n ? 'var(--color-texto)' : 'var(--color-apagado)',
              }}
            >
              Intento {n}
            </button>
          ))}
        </div>
        <Insignia estado={veredicto} tipo="qa" />
      </motion.div>
      <ul className="space-y-2.5">
        {CRITERIOS.map((c, i) => (
          <motion.li key={c.id} variants={pieza} className="flex items-start gap-3 text-sm">
            <Tilde ok={resultados[i] ?? true} />
            <span className="min-w-0">
              {c.texto}
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  key={`${intento}-${c.id}`}
                  className="mt-0.5 block text-xs text-[var(--color-apagado)]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {resultados[i]
                    ? `Cumple: cita ${c.evidencia.split(',')[0]}.`
                    : 'Sin evidencia: se pide la tabla comparativa.'}
                </motion.span>
              </AnimatePresence>
            </span>
          </motion.li>
        ))}
      </ul>
      <motion.p
        variants={pieza}
        className="rounded-xl border px-4 py-3 text-sm leading-relaxed"
        style={{
          borderColor: `color-mix(in oklch, ${color} 35%, transparent)`,
          backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
          color,
        }}
      >
        {intento === 1
          ? `Veredicto: ${etiqueta}. Falta demostrar C3; corregí y volvé a entregar.`
          : `Veredicto: ${etiqueta}. T4 y T5 se desbloquean y la reputación de Lucía sube.`}
      </motion.p>
    </Lienzo>
  );
}

/* ------------------------------------------------------------------------------------- */
/* Manifiesto: las palabras se encienden al pasar                                         */
/* ------------------------------------------------------------------------------------- */

export function Manifiesto({ texto }: { texto: string }) {
  const caja = useRef<HTMLParagraphElement>(null);
  const reducir = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: caja, offset: ['start 0.85', 'end 0.45'] });
  const palabras = useMemo(() => texto.split(' '), [texto]);

  return (
    <p
      ref={caja}
      className="text-3xl leading-[1.15] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl"
    >
      {palabras.map((palabra, i) => (
        <Palabra
          key={`${palabra}-${i}`}
          progreso={scrollYProgress}
          desde={i / palabras.length}
          hasta={(i + 1) / palabras.length}
          quieta={reducir === true}
        >
          {palabra}
        </Palabra>
      ))}
    </p>
  );
}

function Palabra({
  children,
  progreso,
  desde,
  hasta,
  quieta,
}: {
  children: string;
  progreso: MotionValue<number>;
  desde: number;
  hasta: number;
  quieta: boolean;
}) {
  const opacidad = useTransform(progreso, [desde, hasta], [0.18, 1]);
  return (
    <motion.span style={{ opacity: quieta ? 1 : opacidad }} className="inline-block pr-[0.25em]">
      {children}
    </motion.span>
  );
}
