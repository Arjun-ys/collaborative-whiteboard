import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync(new URL('../client/test/', import.meta.url))
  .filter((name) => name.endsWith('.test.ts')).map((name) => `client/test/${name}`);
const result = spawnSync(process.execPath, ['--import', './server/node_modules/tsx/dist/loader.mjs', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
