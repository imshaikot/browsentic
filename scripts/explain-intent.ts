import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const utterance = process.argv.slice(2).join(' ').trim();
if (!utterance) {
  console.error('usage: yarn check:intent "<utterance>"\nThe fixture table runs with: yarn test src/lib/intent');
  process.exit(1);
}

const src = fileURLToPath(new URL('../src', import.meta.url));
const { outputFiles } = await build({
  entryPoints: [`${src}/lib/intent/index.ts`],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  alias: { '@': src },
});
const bundled = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
const { ACT_THRESHOLD, routeIntent } = (await import(bundled)) as typeof import('../src/lib/intent');

console.log(`${utterance}\n${JSON.stringify(routeIntent(utterance), null, 2)}\nacts at ${ACT_THRESHOLD}`);
