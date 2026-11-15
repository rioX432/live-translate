// Bundles the bench entry points together with the real product classes so they
// run under plain Node. `electron` resolves to a stub; every other package stays
// external so native addons load from the repository's node_modules.
import { build } from 'esbuild'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))

const electronStub = {
  name: 'electron-stub',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: join(here, 'electron-stub.ts') }))
    b.onResolve({ filter: /^[^./]/ }, (args) => (args.path === 'electron' ? undefined : { external: true }))
  }
}

const entries = process.argv.slice(2)
await build({
  entryPoints: {
    // worker-pool forks join(__dirname, 'slm-worker.js'), so the worker must sit next to the runners.
    'slm-worker': join(here, 'slm-worker-entry.ts'),
    ...Object.fromEntries(entries.map((e) => [e.replace(/\.ts$/, ''), join(here, e)]))
  },
  outdir: join(here, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: 'inline',
  logLevel: 'warning',
  plugins: [electronStub]
})

// The repository root is "type": "module"; the bundles are CommonJS and keep the
// .js name because worker-pool forks 'slm-worker.js'.
writeFileSync(join(here, 'dist', 'package.json'), '{ "type": "commonjs" }\n')
