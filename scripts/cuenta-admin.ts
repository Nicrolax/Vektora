/**
 * VEKTORA — Crea (o asciende) la cuenta de administración.
 *
 *   ADMIN_EMAIL=admin@ejemplo.com ADMIN_PASSWORD='una-frase-larga' npm run cuenta:admin
 *
 * La cuenta admin NO está en los datos de prueba porque su contraseña no puede ser pública.
 * Se crea así en cada base nueva (compose, Aiven, minikube). Si el correo ya existe, se le
 * pone la contraseña nueva y el rol admin.
 *
 * La contraseña viaja por variable de entorno, no por argumento: los argumentos quedan en el
 * historial de la consola y en la lista de procesos. En la base solo queda su hash BCrypt.
 */

import '@/lib/env';

import { crearAuthService } from '@/lib/auth';
import { cerrarDb } from '@/lib/db';
import { mensajeParaUsuario } from '@/lib/errores';

async function main(): Promise<void> {
  const email = process.env['ADMIN_EMAIL']?.trim() ?? '';
  const password = process.env['ADMIN_PASSWORD'] ?? '';
  if (email === '' || password === '') {
    console.error(
      "\nUso: ADMIN_EMAIL=admin@ejemplo.com ADMIN_PASSWORD='al menos 12 caracteres' npm run cuenta:admin\n",
    );
    process.exitCode = 1;
    return;
  }

  const { id, creada } = await crearAuthService().asegurarAdmin(email, password);
  console.log(`\n✓ ${creada ? 'Cuenta de administración creada' : 'Cuenta existente ascendida a admin'}: ${email} (${id})\n`);
}

main()
  .finally(() => cerrarDb())
  .catch((error: unknown) => {
    console.error(`\n✗ ${mensajeParaUsuario(error, () => undefined)}`);
    if (error instanceof Error) console.error(`  detalle: ${error.message}\n`);
    process.exitCode = 1;
  });
