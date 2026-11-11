// SonarJS (el analizador de SonarLint / SonarQube for IDE) por línea de comandos.
//
// No se agrega al package.json a propósito: es una herramienta de auditoría, no de compilación.
// Para correrlo, en una carpeta FUERA del repositorio:
//
//   npm init -y
//   npm install eslint@9 eslint-plugin-sonarjs typescript-eslint typescript@5
//   (copiar este archivo ahí)
//
// y desde la raíz del repositorio:
//
//   node <carpeta>/node_modules/eslint/bin/eslint.js -c <carpeta>/sonarjs.eslint.config.mjs lib app components
//
// Resultados y análisis de cada hallazgo: docs/informe-seguridad.md, sección 2.
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/node_modules/**', '**/.next/**', 'tests/**', 'scripts/**', 'sql/**'] },
  {
    files: ['lib/**/*.ts', 'app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    ...sonarjs.configs.recommended,
  },
];
