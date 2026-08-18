const { build } = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'src/wallet/privy-runtime.ts');

const patchOxWorkerImport = {
  name: 'patch-ox-node-worker-import',
  setup(buildApi) {
    buildApi.onLoad({ filter: /ox[/\\]_esm[/\\]tempo[/\\]internal[/\\]virtualMasterPool\.js$/ }, async (args) => {
      const original = await fs.readFile(args.path, 'utf8');
      const contents = original.replace(
        'await import(id)',
        'await import(/* webpackIgnore: true */ id)',
      );
      if (contents === original) {
        throw new Error(`Não foi possível aplicar o patch seguro em ${args.path}`);
      }
      return { contents, loader: 'js' };
    });
  },
};

async function bundle(format, outfile) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format,
    platform: 'browser',
    target: ['es2022'],
    sourcemap: true,
    legalComments: 'linked',
    plugins: [patchOxWorkerImport],
  });
  const output = await fs.readFile(outfile, 'utf8');
  if (/node:worker_threads|virtualMasterPool|import\(id\)/.test(output)) {
    throw new Error(`O chunk ${outfile} ainda contém o import dinâmico não analisável de ox/tempo`);
  }
}

Promise.all([
  bundle('esm', path.join(root, 'dist/esm/wallet/privy-runtime.js')),
  bundle('cjs', path.join(root, 'dist/cjs/wallet/privy-runtime.js')),
]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
