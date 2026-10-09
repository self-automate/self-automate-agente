/**
 * Monta `dist/bot-agente.exe` a partir deste repositório.
 *
 *   npm run empacotar
 *
 * A versão gravada no binário vem de `versao.json`: o commit do repositório de
 * origem, de onde este código foi exportado. Recusa árvore com alteração não
 * commitada: um binário cuja versão aponta para um código que não é o dele não
 * pode ser investigado depois.
 *
 * Não assina nada. A assinatura de código vem depois, no CI; este script só
 * monta, e imprime o SHA-256 do que montou.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ENTRADA_DA_CASCA, empacotarBundle, montarExecutavel } from './empacotar-nucleo.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(RAIZ, 'dist');

if (platform() !== 'win32') {
  console.error('Este script só roda no Windows: o .exe é o node.exe desta máquina com o agente dentro.');
  process.exit(1);
}

// A versão gravada no binário é a do repositório de ORIGEM, de onde este
// código foi exportado: é com ela que o console compara o agente.
let commit;
let data;
try {
  ({ commit, data } = JSON.parse(readFileSync(join(RAIZ, 'versao.json'), 'utf8')));
} catch {
  console.error('Não consegui ler versao.json — é dele que sai a versão gravada no executável.');
  process.exit(1);
}
if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit) || Number.isNaN(Date.parse(data))) {
  console.error(`versao.json não traz um commit e uma data válidos (commit: ${JSON.stringify(commit)}). Exportação de teste não vira executável.`);
  process.exit(1);
}

let alterado;
try {
  alterado = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: RAIZ, encoding: 'utf8' }).trim();
} catch {
  console.error('Não consegui ler o git para conferir que a árvore está limpa.');
  process.exit(1);
}
if (alterado) {
  console.error(`A árvore tem alteração não commitada — a versão ${commit} não descreveria este binário:\n${alterado}`);
  process.exit(1);
}

mkdirSync(DIST, { recursive: true });
const empacotado = join(DIST, 'agente-empacotada.cjs');
const exe = join(DIST, 'bot-agente.exe');

console.log(`1/2  bundle de ${ENTRADA_DA_CASCA}, versão ${commit}...`);
await empacotarBundle({ raiz: RAIZ, entrada: ENTRADA_DA_CASCA, versao: { commit, data }, empacotado });
console.log('2/2  executável único (SEA)...');
await montarExecutavel({ empacotado, pastaDeTrabalho: DIST, nome: 'agente', exe });

const sha256 = createHash('sha256').update(readFileSync(exe)).digest('hex');
console.log(`\n${exe}`);
console.log(`  versão  ${commit}  (commit de ${data})`);
console.log(`  Node    ${process.version}`);
console.log(`  tamanho ${(statSync(exe).size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  sha256  ${sha256}`);
