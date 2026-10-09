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

/**
 * O Playwright (e o SFTP) vêm do DISCO, ao lado do `.exe`, e não de dentro
 * dele: num SEA o `require` embutido só serve módulo do próprio Node, e o
 * `playwright-core` resolve os próprios arquivos em tempo de execução. O
 * pacote vira um módulo de uma linha que chama o `require` de disco do banner.
 * `playwright` (o invólucro) é atendido pelo `playwright-core` (a biblioteca).
 */
export function atalhoDePlaywrightNoDisco() {
  // As âncoras importam: sem elas, `playwright-chromium` e `@playwright/test` cairiam aqui.
  const FILTRO = /^(playwright(-core)?|ssh2-sftp-client|ssh2)$/;
  const NO_DISCO = { playwright: 'playwright-core' };
  return {
    name: 'playwright-de-disco',
    setup(build) {
      build.onResolve({ filter: FILTRO }, (args) => ({
        path: NO_DISCO[args.path] ?? args.path,
        namespace: 'playwright-de-disco',
      }));
      build.onLoad({ filter: /.*/, namespace: 'playwright-de-disco' }, (args) => ({
        // CommonJS, porque o SEA roda o ponto de entrada por `embedderRunCjs`; e
        // `globalThis.` para o esbuild não marcar o nome como indefinido.
        contents: `module.exports = globalThis.__requireDeDisco('${args.path}');`,
        loader: 'js',
      }));
    },
  };
}
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
    // O atalho do Playwright SEMPRE: a casca usa o Playwright desde a 0163 (o
    // gravador), e um bundle sem ele tenta empacotar o playwright-core e quebra.
    plugins: plugins.some((p) => p.name === 'playwright-de-disco') ? plugins : [atalhoDePlaywrightNoDisco(), ...plugins],
  };
}

/** O bundle, já escrito em `empacotado`. */
export async function empacotarBundle(p) {
  await build(configDoBundle({ ...p, outfile: p.empacotado }));
}

/**
 * Nome e versão do produto, como as Propriedades do Windows os mostram. A
 * versão do arquivo é a data UTC do commit (`ano.mês.dia.HHMM` — cada parte
 * cabe em 16 bits), e a do produto leva o commit junto, para quem olhar saber
 * de onde o binário saiu.
 *
 * @param {{ commit: string, data: string }} versao
 */
export function metadadosDaVersao({ commit, data }) {
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) throw new Error(`a data da versão não é uma data: ${JSON.stringify(data)}`);
  const [ano, mes, dia] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  return {
    produto: 'Self Automate Agent',
    empresa: 'Self Automate',
    descricao: 'Self Automate - agente Windows',
    versaoDoArquivo: [ano, mes, dia, d.getUTCHours() * 100 + d.getUTCMinutes()],
    versaoDoProduto: `${ano}.${mes}.${dia} (${commit})`,
  };
}

/**
 * Grava os metadados no recurso de versão do executável. Sem isso o agente se
 * apresenta como o `node.exe` que ele é por dentro ("Node.js 22.13.1").
 *
 * @param {string} exe
 * @param {ReturnType<typeof metadadosDaVersao>} m
 */
export async function gravarMetadados(exe, m) {
  const { NtExecutable, NtExecutableResource, Resource } = await import('resedit');
  // A assinatura do Node já não vale depois de mexer no arquivo; sai junto.
  const pe = NtExecutable.from(readFileSync(exe), { ignoreCert: true });
  const recursos = NtExecutableResource.from(pe);
  const idioma = { lang: 1033, codepage: 1200 };
  const vi = Resource.VersionInfo.createEmpty();
  vi.lang = idioma.lang;
  const [a, b, c, d] = m.versaoDoArquivo;
  vi.setFileVersion(a, b, c, d, idioma.lang);
  vi.setProductVersion(a, b, c, d, idioma.lang);
  vi.setStringValues(idioma, {
    ProductName: m.produto,
    CompanyName: m.empresa,
    FileDescription: m.descricao,
    FileVersion: m.versaoDoArquivo.join('.'),
    ProductVersion: m.versaoDoProduto,
    OriginalFilename: 'bot-agente.exe',
    InternalName: 'bot-agente',
    LegalCopyright: 'Self Automate - Apache-2.0',
  });
  // Troca o recurso de versão inteiro: editar o do Node deixaria campo dele.
  recursos.entries = recursos.entries.filter((e) => e.type !== 16);
  vi.outputToResourceEntries(recursos.entries);
  recursos.outputResource(pe);
  writeFileSync(exe, Buffer.from(pe.generate()));
}

/**
 * Passos 2 a 4: do bundle CommonJS ao `.exe`.
 *
 * @param {{ empacotado: string, pastaDeTrabalho: string, nome: string, exe: string, versao: { commit: string, data: string } }} p
 */
export async function montarExecutavel({ empacotado, pastaDeTrabalho, nome, exe, versao }) {
  const blob = join(pastaDeTrabalho, `sea-${nome}.blob`);
  const config = join(pastaDeTrabalho, `sea-${nome}.json`);
  writeFileSync(config, JSON.stringify({ main: empacotado, output: blob, disableExperimentalSEAWarning: true }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  // Apagar antes: copiar por cima de um `.exe` já injetado deixaria o blob
  // antigo no arquivo, e o executável rodaria a versão anterior sem avisar.
  rmSync(exe, { force: true });
  copyFileSync(process.execPath, exe);
  // Nome e versão ANTES de injetar: o recurso do agente entra por cima de um
  // executável que já diz o que é.
  await gravarMetadados(exe, metadadosDaVersao(versao));
  await postject.inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), { sentinelFuse: FUSIVEL_DO_SEA });
}
