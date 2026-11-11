import Link from 'next/link';

export function PestanasAdmin({ activa }: { activa: 'cuentas' | 'skills' }) {
  const clase = (nombre: string) =>
    `rounded-lg px-3 py-1.5 text-sm ${nombre === activa ? 'bg-[var(--color-lienzo-alto)] text-[var(--color-texto)]' : 'text-[var(--color-apagado)] hover:text-[var(--color-tenue)]'}`;
  return (
    <nav aria-label="Administración" className="flex gap-1">
      <Link href="/admin/cuentas" className={clase('cuentas')} aria-current={activa === 'cuentas' ? 'page' : undefined}>
        Cuentas
      </Link>
      <Link href="/admin/skills" className={clase('skills')} aria-current={activa === 'skills' ? 'page' : undefined}>
        Catálogo de skills
      </Link>
    </nav>
  );
}
