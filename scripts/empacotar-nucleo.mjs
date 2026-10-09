/**
 * Monta o executável único do agente (Node SEA) — o núcleo que o empacotador
 * do repositório público e o empacotador interno usam, para os dois não
 * divergirem.
 *
 *   1. bundle CommonJS (o SEA roda o ponto de entrada por `embedderRunCjs`;
 *      com ESM ele quebra só na hora de rodar)
 *   2. blob do SEA          — `node --experimental-sea-config`
 *   3. cópia do node.exe    — o executável É o próprio Node, com o blob dentro
 *   4. injeção (postject)   — pelo fusível que o Node procura ao iniciar
 *
 * Só no Windows: o `.exe` é o `node.exe` da máquina que monta.
 */
import { build } from 'esbuild';
import postject from 'postject';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENTRADA_DA_CASCA = 'src/bot-agente-cli.ts';
export const FUSIVEL_DO_SEA = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/**
 * A configuração do bundle, num lugar só. Entre a sondagem e o empacotamento
 * mudam apenas a versão e a saída.
 *
 * @param {{ raiz: string, entrada: string, versao: { commit: string, data: string }, outfile?: string, plugins?: import('esbuild').Plugin[] }} p
 */
export function configDoBundle({ raiz, entrada, versao, outfile, plugins = [] }) {
  return {
    absWorkingDir: raiz,
    entryPoints: [join(raiz, entrada)],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    ...(outfile ? { outfile } : {}),
    define: {
      // A versão vai GRAVADA no binário: a máquina onde o agente roda não tem
      // a variável de ambiente, e o `--status` é o diagnóstico dela.
      'process.env.VERSAO_COMMIT': JSON.stringify(versao.commit),
      'process.env.VERSAO_DATA': JSON.stringify(versao.data),
      // Bibliotecas com binário nativo usam este gancho para carregar do disco:
      // dentro do SEA, o `require` embutido só serve módulo do próprio Node.
      __webpack_require__: 'globalThis.__requireDeDisco',
      __non_webpack_require__: 'globalThis.__requireDeDisco',
    },
    // O `require` de disco nasce antes de qualquer módulo, ancorado na pasta
    // `navegador` ao lado do `.exe` (onde ficam o playwright-core e o
    // navegador); a busca sobe dali para `<pasta>\node_modules`.
    banner: {
      js:
        "const __pastaDoExe = require('path').dirname(process.execPath);" +
        "const __navegadorNoDisco = require('path').join(__pastaDoExe, 'navegador');" +
        'process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || __navegadorNoDisco;' +
        "globalThis.__requireDeDisco = require('module').createRequire(" +
        "require('path').join(__navegadorNoDisco, 'node_modules', 'ancora.js'));",
    },
    plugins,
  };
}

/** O bundle, já escrito em `empacotado`. */
export async function empacotarBundle(p) {
  await build(configDoBundle({ ...p, outfile: p.empacotado }));
}

/**
 * Passos 2 a 4: do bundle CommonJS ao `.exe`.
 *
 * @param {{ empacotado: string, pastaDeTrabalho: string, nome: string, exe: string }} p
 */
export async function montarExecutavel({ empacotado, pastaDeTrabalho, nome, exe }) {
  const blob = join(pastaDeTrabalho, `sea-${nome}.blob`);
  const config = join(pastaDeTrabalho, `sea-${nome}.json`);
  writeFileSync(config, JSON.stringify({ main: empacotado, output: blob, disableExperimentalSEAWarning: true }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  // Apagar antes: copiar por cima de um `.exe` já injetado deixaria o blob
  // antigo no arquivo, e o executável rodaria a versão anterior sem avisar.
  rmSync(exe, { force: true });
  copyFileSync(process.execPath, exe);
  await postject.inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), { sentinelFuse: FUSIVEL_DO_SEA });
}
