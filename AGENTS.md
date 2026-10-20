# Verification

- Main app: `npm test` (statistics chat tests), `npx tsc --noEmit`, `npm run build` (Webpack production build), `npm run lint` (ESLint flat config).
- The PI sidecar has its own `package.json` and `package-lock.json`; install and audit separately in `pi-sidecar/`.
- Keep TypeScript on 6.x while the typescript-eslint dependency of eslint-config-next requires TypeScript <6.1.0. TypeScript 7 currently causes the linter to abort.
- Keep ESLint on 9.x while eslint-plugin-react, eslint-plugin-import and eslint-plugin-jsx-a11y do not declare ESLint 10 support.
- The current React Hooks lint rules report existing component issues; a successful build does not imply that lint passes.
