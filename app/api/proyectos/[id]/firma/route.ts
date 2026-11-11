/**
 * VEKTORA — Firma del estado de las tareas de un proyecto, para el sondeo de la vista.
 *
 * Devuelve un texto que cambia cuando cambia el estado o la asignación de alguna tarea. No
 * devuelve datos: la página se vuelve a renderizar en el servidor si la firma cambió. Corre
 * como la persona (RLS): sin sesión 401, sin acceso 404 — igual que si no existiera.
 */

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { firmaDelProyecto } from '@/lib/consultas';
import { esUuid } from '@/lib/db';
import { estadoHttpDe, mensajeParaUsuario } from '@/lib/errores';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (user === null) return NextResponse.json({ error: 'Iniciá sesión.' }, { status: 401 });

  const { id } = await params;
  if (!esUuid(id)) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });

  try {
    const firma = await firmaDelProyecto(user.id, id);
    if (firma === null) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });
    return NextResponse.json({ firma }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: mensajeParaUsuario(error) }, { status: estadoHttpDe(error) });
  }
}
