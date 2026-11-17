import { redirect } from 'next/navigation';
import { tienePermiso } from '@/lib/auth';
import { getSessionUser } from '@/lib/auth/session';
import { Landing } from '@/components/landing/Landing';

export default async function Inicio() {
  const user = await getSessionUser();
  if (user === null) return <Landing />;
  redirect(tienePermiso(user.role, 'proyectos:crear') ? '/panel' : '/proveedor');
}
