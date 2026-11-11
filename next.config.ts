import type { NextConfig } from 'next';

/**
 * VEKTORA — Configuración de Next.js.
 *
 *   · `output: 'standalone'` — `next build` deja en `.next/standalone` un `server.js` con
 *     SOLO las dependencias que se usan. Es lo que copia la etapa final del Dockerfile: la
 *     imagen no lleva `node_modules` completo ni las herramientas de compilación.
 *   · `serverExternalPackages: ['pg']` — `pg` se carga desde `node_modules` en tiempo de
 *     ejecución en vez de empaquetarse. Abre sockets TCP y tiene un módulo nativo opcional
 *     (`pg-native`) que el empaquetador no sabe resolver.
 *   · `poweredByHeader: false` — no anunciar `X-Powered-By: Next.js` (información gratis
 *     para quien busca versiones vulnerables).
 */
const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  typedRoutes: true,
};

export default config;
