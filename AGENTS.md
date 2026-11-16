# Verification

- Main app: `npm test` (statistics chat and weather-data regression tests), `npx tsc --noEmit`, `npm run build` (Webpack production build), `npm run lint` (ESLint flat config).
- The PI sidecar has its own `package.json` and `package-lock.json`; install and audit separately in `pi-sidecar/`.
- Sidecar regression tests: `npm --prefix pi-sidecar test` starts the sidecar against a local mock OpenAI-compatible provider, without real credentials or paid model calls. To test its Docker image, bind-mount `pi-sidecar/server.test.mjs` read-only to `/app/server.test.mjs` and run `npm test` with `--network none`.
- Keep TypeScript on 6.x while the typescript-eslint dependency of eslint-config-next requires TypeScript <6.1.0. TypeScript 7 currently causes the linter to abort.
- Keep ESLint on 9.x while eslint-plugin-react, eslint-plugin-import and eslint-plugin-jsx-a11y do not declare ESLint 10 support.
- The current React Hooks lint rules report existing component issues; a successful build does not imply that lint passes.

# Stored weather data

- `tests/weatherData.test.ts` exercises the real DuckDB/Parquet API paths in a temporary directory, without production data or services.
- Allsensors channel metrics may be stored as VARCHAR in Parquet. Include them explicitly and convert them numerically; never substitute another channel when a metric is missing.
- Daily buckets are calendar dates, not measurement times. Range extrema retain separate original timestamps, choosing the earliest measurement when values tie.
- The production weather app on SSH host `big` uses `/media/docker/ecowitt-nextjs15` (container `ecowitt`, localhost port 3010), not `/media/docker/eta2weather.nextjs15`.
