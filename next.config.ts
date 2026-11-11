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
 *   · `headers()` — cabeceras de seguridad en TODAS las respuestas (hallazgos de OWASP ZAP,
 *     ver docs/informe-seguridad.md).
 */

const desarrollo = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy: el navegador solo ejecuta y carga lo que sale de nuestro propio
 * origen. `'unsafe-inline'` en scripts y estilos es una concesión conocida: Next inyecta
 * scripts en línea para hidratar la página y la interfaz usa `style={…}` para colores y
 * anchos dinámicos. El riesgo queda acotado porque React escapa todo texto que se muestra
 * y la app nunca inserta HTML de usuarios. `'unsafe-eval'` solo en desarrollo (recarga en
 * caliente de Next). Sin `upgrade-insecure-requests`: en minikube se entra por http.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${desarrollo ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const cabecerasDeSeguridad = [
  { key: 'Content-Security-Policy', value: csp },
  // Nadie puede meter la app en un <iframe> (clickjacking). Equivale a frame-ancestors.
  { key: 'X-Frame-Options', value: 'DENY' },
  // El navegador no «adivina» tipos: un archivo de texto no se ejecuta como script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // A otros sitios solo les llega el origen, nunca la ruta (con IDs de proyectos).
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // La app no usa cámara, micrófono, ubicación ni pagos: se apagan para cualquier script.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // Dos años solo por HTTPS. Los navegadores la ignoran por http (minikube), como debe ser.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // Aislamiento entre ventanas y recursos de otros orígenes (mitiga ataques tipo Spectre).
  // Todo lo que carga la página sale de nuestro origen, así que se puede exigir.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    return [{ source: '/:path*', headers: cabecerasDeSeguridad }];
  },
  /**
   * Sin cookie de sesión, las rutas privadas van a /entrar ANTES de renderizar. Sin esto,
   * el `redirect()` de las páginas responde 307 con el cascarón HTML de la página (5-6 KB;
   * ZAP lo marca como «Big Redirect»). No reemplaza a `requireUser()`: una cookie vencida
   * o falsa llega igual a la página, que la verifica y redirige como siempre.
   */
  async redirects() {
    // El mismo nombre que NOMBRE_COOKIE (lib/auth/cookie.ts); tests/next-config.test.ts lo vigila.
    const sinSesion = [{ type: 'cookie' as const, key: 'vektora_sesion' }];
    return [
      { source: '/', missing: sinSesion, destination: '/entrar', permanent: false },
      {
        source: '/:seccion(panel|proyectos|tareas|trabajo|proveedor|buscar|reportes|admin)/:resto*',
        missing: sinSesion,
        destination: '/entrar',
        permanent: false,
      },
    ];
  },
};

export default config;
