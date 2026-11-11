import { redirect } from 'next/navigation';
import { requirePermiso } from '@/lib/auth/session';

export default async function Admin() {
  await requirePermiso('admin:cuentas');
  redirect('/admin/cuentas');
}
