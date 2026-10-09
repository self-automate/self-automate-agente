import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { provaConfere, type ChavesDePublicacao } from './procedencia.js';
import type { Robo } from '../robo.js';
export const ARQUIVO_DAS_MONTAGENS = 'montagens.json';
export const NOME_DAS_MONTAGENS = 'montagens';
export interface ConjuntoDeMontagens {
    contrato: 1;
    organizacao: string;
    versao: string;
    montagens: Array<{
        nome: string;
        montagem: Record<string, unknown>;
    }>;
}
export const ORGANIZACAO = /^[a-z0-9][a-z0-9-]{0,62}$/;
const NOME_DE_ROBO = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const VERSAO = /^[0-9A-Za-z._:+-]{1,64}$/;
const MAXIMO = 500;
const ehObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
export function problemaDoConjunto(x: unknown): string | undefined {
    if (!ehObjeto(x))
        return 'o conjunto de montagens não é um objeto';
    if (x.contrato !== 1)
        return `contrato ${String(x.contrato)} desconhecido (esta casca conhece o 1)`;
    if (typeof x.organizacao !== 'string' || !ORGANIZACAO.test(x.organizacao))
        return 'organização ausente ou inválida';
    if (typeof x.versao !== 'string' || !VERSAO.test(x.versao))
        return 'versão ausente ou inválida';
    if (!Array.isArray(x.montagens))
        return 'as montagens não vieram numa lista';
    if (x.montagens.length > MAXIMO)
        return `mais de ${MAXIMO} montagens num conjunto`;
    const vistos = new Set<string>();
    for (const m of x.montagens as unknown[]) {
        if (!ehObjeto(m) || typeof m.nome !== 'string' || !NOME_DE_ROBO.test(m.nome))
            return 'montagem sem nome válido de robô';
        if (vistos.has(m.nome))
            return `nome repetido no conjunto: ${m.nome}`;
        vistos.add(m.nome);
        if (!ehObjeto(m.montagem) || m.montagem.nome !== m.nome)
            return `a montagem de ${m.nome} não traz o mesmo nome dentro`;
    }
    return undefined;
}
const soV2 = (chaves: string | ChavesDePublicacao): ChavesDePublicacao => ({ v1: '', v2: typeof chaves === 'string' ? '' : chaves.v2 });
const lerOuNada = (caminho: string): Buffer | undefined => {
    try {
        return readFileSync(caminho);
    }
    catch {
        return undefined;
    }
};
export function lerConjunto(conteudo: Buffer): {
    ok: true;
    conjunto: ConjuntoDeMontagens;
} | {
    ok: false;
    motivo: string;
} {
    let lido: unknown;
    try {
        lido = JSON.parse(conteudo.toString('utf8'));
    }
    catch {
        return { ok: false, motivo: 'o conjunto de montagens não é JSON' };
    }
    const problema = problemaDoConjunto(lido);
    return problema ? { ok: false, motivo: problema } : { ok: true, conjunto: lido as ConjuntoDeMontagens };
}
export type ResultadoDasMontagens = {
    ok: true;
    conjunto: ConjuntoDeMontagens | undefined;
} | {
    ok: false;
    motivo: string;
};
export function carregarMontagensDoDisco(p: {
    pasta: string;
    chavePublica: string | ChavesDePublicacao;
    ler?: (caminho: string) => Buffer | undefined;
}): ResultadoDasMontagens {
    const ler = p.ler ?? lerOuNada;
    const arquivo = join(p.pasta, ARQUIVO_DAS_MONTAGENS);
    const conteudo = ler(arquivo);
    if (!conteudo || conteudo.length === 0)
        return { ok: true, conjunto: undefined };
    if (!provaConfere(conteudo, ler(`${arquivo}.sig`), soV2(p.chavePublica), ARQUIVO_DAS_MONTAGENS)) {
        return { ok: false, motivo: 'a prova das montagens não confere (só vale a v2 do cofre, com o artefato montagens.json) — montagens recusadas' };
    }
    const r = lerConjunto(conteudo);
    return r.ok ? { ok: true, conjunto: r.conjunto } : { ok: false, motivo: `montagens recusadas: ${r.motivo}` };
}
export interface MundoDasMontagens {
    pasta: string;
    chavePublica: string | ChavesDePublicacao;
    baixarAssinatura: () => Promise<Buffer | undefined>;
    baixarConjunto: () => Promise<Buffer>;
}
export async function atualizarMontagensSePreciso(m: MundoDasMontagens): Promise<{
    trocou: boolean;
    mensagem: string;
}> {
    const arquivo = join(m.pasta, ARQUIVO_DAS_MONTAGENS);
    const prova = `${arquivo}.sig`;
    const remota = await m.baixarAssinatura().catch(() => undefined);
    if (!remota || remota.length === 0)
        return { trocou: false, mensagem: 'o painel não tem montagens publicadas (ou não respondeu) — mantido o que há' };
    const local = lerOuNada(prova);
    if (local && local.equals(remota) && existsSync(arquivo))
        return { trocou: false, mensagem: 'montagens em dia' };
    let conteudo: Buffer;
    try {
        conteudo = await m.baixarConjunto();
    }
    catch (erro) {
        return { trocou: false, mensagem: `não consegui baixar as montagens: ${erro instanceof Error ? erro.message : String(erro)} — mantidas as anteriores` };
    }
    if (!provaConfere(conteudo, remota, soV2(m.chavePublica), ARQUIVO_DAS_MONTAGENS)) {
        return { trocou: false, mensagem: 'as montagens baixadas não conferem com a prova (só vale a v2 do cofre) — mantidas as anteriores' };
    }
    const r = lerConjunto(conteudo);
    if (!r.ok)
        return { trocou: false, mensagem: `as montagens baixadas não fecham com o contrato: ${r.motivo} — mantidas as anteriores` };
    writeFileSync(`${arquivo}.novo`, conteudo);
    writeFileSync(`${prova}.novo`, remota);
    renameSync(`${arquivo}.novo`, arquivo);
    renameSync(`${prova}.novo`, prova);
    return { trocou: true, mensagem: `montagens atualizadas: ${r.conjunto.organizacao} ${r.conjunto.versao}, ${r.conjunto.montagens.length} robôs` };
}
export type InterpretarMontagem = (montagem: unknown, robo: (nome: string) => Robo | undefined) => Robo;
export function robosDasMontagens(p: {
    conjunto: ConjuntoDeMontagens;
    organizacao: string;
    doPacote: readonly Robo[];
    interpretar: InterpretarMontagem | undefined;
}): {
    robos: Robo[];
    recusas: string[];
} {
    const nomes = p.conjunto.montagens.map((m) => m.nome);
    if (p.conjunto.organizacao !== p.organizacao) {
        return { robos: [], recusas: [`as montagens são da organização ${p.conjunto.organizacao}, e o pacote é de ${p.organizacao} — nenhuma carregada`] };
    }
    if (!p.interpretar) {
        return { robos: [], recusas: [`o pacote desta casca não sabe interpretar montagem (anterior à 0150, 3e3b1) — ${nomes.length} montagem(ns) fora`] };
    }
    const robos: Robo[] = [];
    const recusas: string[] = [];
    const doPacote = new Map(p.doPacote.map((r) => [r.nome, r]));
    const porNome = (nome: string): Robo | undefined => doPacote.get(nome) ?? robos.find((r) => r.nome === nome);
    for (const m of p.conjunto.montagens) {
        if (doPacote.has(m.nome)) {
            recusas.push(`${m.nome}: o pacote já tem um robô com este nome — o código vence`);
            continue;
        }
        try {
            robos.push(p.interpretar(m.montagem, porNome));
        }
        catch (erro) {
            recusas.push(`${m.nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
        }
    }
    return { robos, recusas };
}
