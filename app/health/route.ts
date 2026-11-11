/**
 * VEKTORA — `/health` (requisito R12).
 *
 * 200 si la aplicación está viva Y la base responde a `select 1` en menos de 3 segundos;
 * 503 si no. Lo consultan:
 *
 *   · el HEALTHCHECK del Dockerfile y el healthcheck del docker-compose,
 *   · Render (Health Check Path) antes de mandarle tráfico a una versión nueva,
 *   · las `livenessProbe` y `readinessProbe` de Kubernetes.
 *
 * No devuelve datos internos: ni host, ni versión de PostgreSQL, ni el texto de un error.
 * Un endpoint público que explica por qué falla la base le regala información a cualquiera.
 * También da 503 si falta `AUTH_SECRET`: sin él nadie puede iniciar sesión, y una instancia
 * así no debería recibir tráfico.
 */

import { NextResponse } from 'next/server';
import { secretoDeSesion } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const inicio = Date.now();

  let configuracion = true;
  try {
    secretoDeSesion();
  } catch {
    configuracion = false;
  }

  let base = false;
  try {
    base = await getDb().ping(3_000);
  } catch {
    base = false;
  }

  const ok = configuracion && base;
  return NextResponse.json(
    {
      estado: ok ? 'ok' : 'error',
      app: 'ok',
      base: base ? 'ok' : 'sin respuesta',
      configuracion: configuracion ? 'ok' : 'incompleta',
      ms: Date.now() - inicio,
    },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
