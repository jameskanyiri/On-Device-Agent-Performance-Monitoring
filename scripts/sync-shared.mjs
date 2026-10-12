// Keeps src/shared in step with the app (../on-device-ai), which owns these types.
//   npm run sync-shared            rewrite src/shared from the app
//   npm run sync-shared -- --check exit 1 if anything has drifted (for CI)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const app = process.env.APP_DIR ?? join(root, '..', 'on-device-ai');
const check = process.argv.includes('--check');

const FILES = [
  { from: 'modules/device-metrics/src/DeviceMetrics.types.ts', to: 'src/shared/device-metrics.ts' },
  { from: 'src/bench/protocol.ts', to: 'src/shared/protocol.ts' },
  { from: 'src/observe/trace.ts', to: 'src/shared/trace.ts' },
];

if (!existsSync(app)) {
  console.error(`App not found at ${app} (set APP_DIR).`);
  process.exit(1);
}

let drifted = 0;
for (const { from, to } of FILES) {
  const source = readFileSync(join(app, from), 'utf8').replace("from '../../modules/device-metrics';", "from './device-metrics';");
  const wanted = `// Copied from the mobile app (on-device-ai): ${from}. Keep the two in sync.\n${source}`;
  const current = existsSync(join(root, to)) ? readFileSync(join(root, to), 'utf8') : '';
  if (current === wanted) continue;
  drifted++;
  if (check) console.error(`✗ ${to} differs from the app's ${from}`);
  else {
    writeFileSync(join(root, to), wanted);
    console.log(`✓ updated ${to}`);
  }
}

// The model list is hand-written (names for the Benchmark page); its ids must match the app's.
const appIds = [...readFileSync(join(app, 'src/lib/chat-models.ts'), 'utf8').matchAll(/^\s*id: '([^']+)'/gm)].map((m) => m[1]);
const ourIds = [...readFileSync(join(root, 'src/shared/models.ts'), 'utf8').matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
const missing = appIds.filter((id) => !ourIds.includes(id));
const extra = ourIds.filter((id) => !appIds.includes(id));
if (missing.length || extra.length) {
  drifted++;
  console.error(`✗ src/shared/models.ts: ${missing.length ? `missing ${missing.join(', ')}` : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? `not in the app: ${extra.join(', ')}` : ''}`);
}

if (!drifted) console.log('src/shared is in sync with the app.');
process.exit(check && drifted ? 1 : 0);
