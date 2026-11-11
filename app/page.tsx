import { redirect } from 'next/navigation';
import { tienePermiso } from '@/lib/auth';
import { getSessionUser } from '@/lib/auth/session';

export default async function Inicio() {
  const user = await getSessionUser();
  if (user === null) redirect('/entrar');
  redirect(tienePermiso(user.role, 'proyectos:crear') ? '/panel' : '/proveedor');
}
