/**
 * Pruebas de INTEGRACIÓN contra una base PostgreSQL real con `sql/` cargado.
 *
 *   VEKTORA_TEST_DB=1 npm run test:integracion      (usa los DB_* del entorno)
 *
 * Sin `VEKTORA_TEST_DB=1` se saltean: `npm test` no necesita base. En CI corren contra el
 * servicio `pgvector/pgvector:pg16` del workflow, recién cargado con los scripts de `sql/`.
 *
 * Crean sus propias cuentas (correo aleatorio) y no dependen de los datos demo, así se
 * pueden correr varias veces sobre la misma base.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminService } from '@/lib/admin';
import { AuthService, MENSAJE_CREDENCIALES, PostgresCuentasRepository } from '@/lib/auth';
import { buscarTareas, normalizarFiltros, reporteGeneral } from '@/lib/consultas';
import { cerrarDb, crearDb, json, type Db } from '@/lib/db';
import { EntregasService, PostgresEntregasRepository } from '@/lib/entregas';
import { AuthError, ConflictoError, PermisoDenegadoError, RecursoNoEncontradoError } from '@/lib/errores';
import { ProyectosService } from '@/lib/proyectos';

const ACTIVA = process.env['VEKTORA_TEST_DB'] === '1';

describe.skipIf(!ACTIVA)('integración con PostgreSQL', () => {
  let db: Db;
  let auth: AuthService;
  const sufijo = randomUUID().slice(0, 8);
  const clave = 'Prueba-Integracion-123';
  let clienteId: string;
  let proveedorId: string;
  let terceroId: string;
  let proyectoId: string;
  let tareaId: string;

  /** Cuántas filas cumplen la condición (como dueño de las tablas, sin RLS). */
  async function contar(sql: string, parametros: string[]): Promise<number> {
    const fila = await db.one<{ n: number }>(`select count(*) as n from ${sql}`, parametros);
    return fila?.n ?? 0;
  }

  beforeAll(async () => {
    db = crearDb();
    // Coste 4 en las pruebas: el algoritmo es el mismo, pero no hace falta esperar 250 ms
    // por hash. La app usa 12.
    auth = new AuthService(new PostgresCuentasRepository(db), 4);
    clienteId = (await auth.registrar({ email: `cli-${sufijo}@prueba.test`, contrasena: clave, role: 'client' })).id;
    proveedorId = (await auth.registrar({ email: `pro-${sufijo}@prueba.test`, contrasena: clave, role: 'provider' })).id;
    terceroId = (await auth.registrar({ email: `ter-${sufijo}@prueba.test`, contrasena: clave, role: 'both' })).id;

    const proyecto = await db.one<{ id: string }>(
      `insert into public.projects (owner_id, title, objective, status, visibility, budget_total)
       values ($1, $2, 'Objetivo de una prueba de integración con PostgreSQL', 'active', 'private', 1000)
       returning id`,
      [clienteId, `Proyecto de integración ${sufijo}`],
    );
    proyectoId = proyecto?.id ?? '';
    const tarea = await db.one<{ id: string }>(
      `insert into public.project_tasks
         (project_id, code, title, acceptance_criteria, required_skills, status, budget, assignee_id, assigned_at)
       values ($1, 'T-01', 'Tarea de integración', $2::jsonb, '{qa-testing}', 'assigned', 400, $3, now())
       returning id`,
      [proyectoId, json([{ id: 'AC-1', criterion: 'Se entrega un informe.', verification: 'Hay un informe.' }]), proveedorId],
    );
    tareaId = tarea?.id ?? '';
  });

  afterAll(async () => {
    await db?.close();
    // Las consultas de lectura (búsqueda, reporte) usan el pool compartido de `getDb()`,
    // que lee los mismos DB_*: también se cierra.
    await cerrarDb();
  });

  describe('autenticación (R3)', () => {
    it('guarda un hash BCrypt, nunca la contraseña', async () => {
      const fila = await db.one<{ password_hash: string }>('select password_hash from auth.users where id = $1', [clienteId]);
      expect(fila?.password_hash).toMatch(/^\$2[aby]\$04\$/);
      expect(fila?.password_hash).not.toContain(clave);
    });

    it('entra con la contraseña correcta y devuelve el rol', async () => {
      const usuario = await auth.iniciarSesion(`CLI-${sufijo}@prueba.test`, clave);
      expect(usuario).toMatchObject({ id: clienteId, role: 'client' });
    });

    it('responde lo mismo con contraseña incorrecta que con correo inexistente', async () => {
      const mal = auth.iniciarSesion(`cli-${sufijo}@prueba.test`, 'otra-clave-123');
      const nadie = auth.iniciarSesion(`nadie-${sufijo}@prueba.test`, clave);
      await expect(mal).rejects.toThrow(MENSAJE_CREDENCIALES);
      await expect(nadie).rejects.toThrow(MENSAJE_CREDENCIALES);
    });

    it('no deja registrar dos veces el mismo correo', async () => {
      await expect(
        auth.registrar({ email: `cli-${sufijo}@prueba.test`, contrasena: clave, role: 'client' }),
      ).rejects.toBeInstanceOf(ConflictoError);
    });

    it('una cuenta suspendida no entra', async () => {
      await db.execute(`update public.users set status = 'suspended' where id = $1`, [terceroId]);
      await expect(auth.iniciarSesion(`ter-${sufijo}@prueba.test`, clave)).rejects.toBeInstanceOf(AuthError);
      await db.execute(`update public.users set status = 'active' where id = $1`, [terceroId]);
    });
  });

  describe('RLS a través de asUser', () => {
    const verProyecto = (userId: string) =>
      db.asUser(userId, (tx) => tx.query('select id from public.projects where id = $1', [proyectoId]));

    it('la dueña ve su proyecto, la proveedora asignada también, un tercero no', async () => {
      expect(await verProyecto(clienteId)).toHaveLength(1);
      expect(await verProyecto(proveedorId)).toHaveLength(1);
      expect(await verProyecto(terceroId)).toHaveLength(0);
    });

    it('authenticated no puede leer los hashes de auth.users', async () => {
      await expect(db.asUser(clienteId, (tx) => tx.query('select password_hash from auth.users'))).rejects.toMatchObject({
        sqlstate: '42501',
      });
    });

    it('un tercero no puede editar el proyecto ajeno (0 filas = no encontrado)', async () => {
      const servicio = new ProyectosService(db);
      await expect(
        servicio.actualizar(terceroId, proyectoId, { title: 'Hackeado', description: null, visibility: 'public' }),
      ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
      await servicio.actualizar(clienteId, proyectoId, {
        title: `Proyecto de integración ${sufijo} (editado)`,
        description: 'Editado en la prueba',
        visibility: 'private',
      });
      const fila = await db.one<{ title: string }>('select title from public.projects where id = $1', [proyectoId]);
      expect(fila?.title).toContain('(editado)');
    });

    it('una cuenta que no es admin no puede tocar el catálogo (RLS skills_write_admin)', async () => {
      await expect(
        new AdminService(db).crearSkill(clienteId, { slug: `x-${sufijo}`, name: 'No debería', category: null }),
      ).rejects.toMatchObject({ sqlstate: '42501' });
    });
  });

  describe('entrega transaccional (R7)', () => {
    const filas = async () => ({
      entregables: await contar('public.deliverables where task_id = $1', [tareaId]),
      auditoria: await contar(`public.audit_logs where entity_type = 'deliverable' and changes ->> 'task_id' = $1`, [tareaId]),
      estado: (await db.one<{ status: string }>('select status from public.project_tasks where id = $1', [tareaId]))?.status,
    });

    it('si falla el último paso, ROLLBACK: no queda ni el entregable ni el cambio de estado', async () => {
      class AuditoriaRota extends PostgresEntregasRepository {
        override async registrarAuditoria(): Promise<void> {
          throw new Error('falla simulada en el último paso');
        }
      }
      const antes = await filas();
      await expect(
        new EntregasService(db, new AuditoriaRota()).entregar(proveedorId, {
          taskId: tareaId,
          summary: 'Informe de pruebas completo',
          content: 'Contenido del informe',
          evidence: { 'AC-1': 'Sección 1' },
        }),
      ).rejects.toThrow('falla simulada');
      expect(await filas()).toEqual(antes);
      expect(antes.estado).toBe('assigned');
    });

    it('otra persona no puede entregar la tarea', async () => {
      await expect(
        new EntregasService(db).entregar(terceroId, { taskId: tareaId, summary: 'Intento ajeno de entrega', content: 'x', evidence: {} }),
      ).rejects.toBeInstanceOf(PermisoDenegadoError);
    });

    it('si todo sale bien, COMMIT: entregable + tarea en submitted + auditoría', async () => {
      const resultado = await new EntregasService(db).entregar(proveedorId, {
        taskId: tareaId,
        summary: 'Informe de pruebas completo',
        content: 'Contenido del informe',
        evidence: { 'AC-1': 'Sección 1', 'NO-ES-CRITERIO': 'se descarta' },
      });
      expect(resultado.version).toBe(1);
      expect(await filas()).toEqual({ entregables: 1, auditoria: 1, estado: 'submitted' });
      const evidencia = await db.one<{ evidence: Record<string, string> }>('select evidence from public.deliverables where id = $1', [
        resultado.deliverableId,
      ]);
      expect(evidencia?.evidence).toEqual({ 'AC-1': 'Sección 1' });
    });

    it('una segunda entrega mientras espera veredicto se rechaza sin escribir nada', async () => {
      await expect(
        new EntregasService(db).entregar(proveedorId, { taskId: tareaId, summary: 'Segunda entrega igual', content: 'x', evidence: {} }),
      ).rejects.toBeInstanceOf(ConflictoError);
      expect(await filas()).toEqual({ entregables: 1, auditoria: 1, estado: 'submitted' });
    });
  });

  describe('búsqueda y reporte (R6, R9)', () => {
    it('un intento de inyección SQL se busca como texto literal', async () => {
      const filtros = normalizarFiltros({ q: "'; drop table public.projects; --" });
      const resultado = await buscarTareas(clienteId, filtros);
      expect(resultado.total).toBe(0);
      expect(await contar('public.projects where id = $1', [proyectoId])).toBe(1);
    });

    it('los filtros combinan texto, estado y presupuesto con JOIN a proyectos', async () => {
      const resultado = await buscarTareas(clienteId, normalizarFiltros({ q: 'integración', estado: 'submitted', min: '100', max: '500' }));
      expect(resultado.tareas.map((t) => t.id)).toEqual([tareaId]);
      expect(resultado.tareas[0]?.projectTitle).toContain(sufijo);
    });

    it('el reporte agrega por proyecto con COUNT, SUM y AVG', async () => {
      const reporte = await reporteGeneral(clienteId);
      const fila = reporte.proyectos.find((p) => p.projectId === proyectoId);
      expect(fila).toMatchObject({ tareas: 1, aprobadas: 0, presupuestoTotal: 400, presupuestoPromedio: 400 });
    });
  });
});
