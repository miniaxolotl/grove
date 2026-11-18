import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'packages/website/public/proofing');
const harper = join(root, 'lib/shared/node_modules/harper.js');
await mkdir(output, { recursive: true });
await Promise.all([
  build({
    entryPoints: [join(root, 'lib/shared/src/writing-harper-worker.ts')],
    bundle: true, platform: 'browser', format: 'esm', minify: true,
    define: {process: 'undefined'},
    outfile: join(output, 'worker.js'),
  }),
  copyFile(join(harper, 'dist/harper_wasm_slim_bg.wasm'), join(output, 'harper.wasm')),
  copyFile(join(harper, 'LICENSE'), join(output, 'LICENSE.txt')),
]);
