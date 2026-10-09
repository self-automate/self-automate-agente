import type { Robo } from '../robo.js';
export const CONTRATO_DO_PACOTE = 1 as const;
export const NOME_DO_PACOTE_DE_ROBOS = 'robos';
export interface RoboDoManifesto {
    nome: string;
    executor?: string;
    blocosDeWindows?: string[];
    precisaDaPlataforma?: boolean;
}
export interface ManifestoDoPacote {
    contrato: typeof CONTRATO_DO_PACOTE;
    organizacao: string;
    commit: string;
    robos: RoboDoManifesto[];
}
export interface DadosDaMaquina {
    pastasDeEntrega: Record<string, {
        caminho: string;
        origem: 'medido' | 'inferido';
    }>;
    relatoriosLegiveis: string[];
    contasNoCodigo: string[];
    raizesFixas: {
        caminho: string;
        origem: 'medido' | 'inferido';
    }[];
    instalacoesDoAa: string[];
}
export interface ConteudoDoPacote {
    manifesto: ManifestoDoPacote;
    robos: readonly Robo[];
    interpretarMontagem?: (montagem: unknown, robo: (nome: string) => Robo | undefined) => Robo;
    dadosDaMaquina?: DadosDaMaquina;
}
const ORIGENS = ['medido', 'inferido'];
const NOME_DE_RELATORIO = /^(?!\.\.?$)[^/\\]+$/;
export function problemaDosDadosDaMaquina(d: unknown): string | undefined {
    if (typeof d !== 'object' || d === null || Array.isArray(d))
        return 'os dados da máquina não são um objeto';
    const x = d as Record<string, unknown>;
    const p = x.pastasDeEntrega;
    if (typeof p !== 'object' || p === null || Array.isArray(p))
        return 'as pastas de entrega não são um objeto';
    for (const [chave, v] of Object.entries(p)) {
        const pasta = v as Record<string, unknown> | null;
        if (!pasta || typeof pasta.caminho !== 'string' || !pasta.caminho)
            return `pasta de entrega ${chave}: sem caminho`;
        if (!ORIGENS.includes(String(pasta.origem)))
            return `pasta de entrega ${chave}: origem desconhecida`;
    }
    if (!Array.isArray(x.relatoriosLegiveis) || !x.relatoriosLegiveis.every((n) => typeof n === 'string' && NOME_DE_RELATORIO.test(n))) {
        return 'relatório legível tem de ser NOME de arquivo, sem caminho';
    }
    if (!Array.isArray(x.contasNoCodigo) || !x.contasNoCodigo.every((c) => typeof c === 'string'))
        return 'conta no código que não é texto';
    if (!Array.isArray(x.raizesFixas) || !x.raizesFixas.every((r) => typeof r?.caminho === 'string' && ORIGENS.includes(String(r?.origem)))) {
        return 'raiz fixa sem caminho ou origem';
    }
    if (!Array.isArray(x.instalacoesDoAa) || !x.instalacoesDoAa.every((i) => typeof i === 'string'))
        return 'instalações do AA não são uma lista de caminhos';
    return undefined;
}
export interface PacoteAnunciado {
    organizacao: string;
    commit: string;
    robos: number;
}
export function pacoteAnunciadoValido(x: unknown): PacoteAnunciado | undefined {
    if (typeof x !== 'object' || x === null || Array.isArray(x))
        return undefined;
    const p = x as Record<string, unknown>;
    if (typeof p.organizacao !== 'string' || !ORGANIZACAO.test(p.organizacao))
        return undefined;
    if (typeof p.commit !== 'string' || !COMMIT.test(p.commit))
        return undefined;
    if (typeof p.robos !== 'number' || !Number.isInteger(p.robos) || p.robos < 0)
        return undefined;
    return { organizacao: p.organizacao, commit: p.commit, robos: p.robos };
}
const ORGANIZACAO = /^[a-z0-9][a-z0-9-]{0,62}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const NOME_DE_ROBO = /^[a-z0-9][a-z0-9._-]{0,99}$/;
type RoboComRotulo = Pick<Robo, 'nome'> & {
    executor?: string;
    blocosDeWindows?: readonly string[];
    precisaDaPlataforma?: boolean;
};
export function manifestoDe(robos: readonly RoboComRotulo[], p: {
    organizacao: string;
    commit: string;
}): ManifestoDoPacote {
    return {
        contrato: CONTRATO_DO_PACOTE,
        organizacao: p.organizacao,
        commit: p.commit,
        robos: [...robos]
            .sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))
            .map((r) => ({
            nome: r.nome,
            ...(r.executor !== undefined ? { executor: r.executor } : {}),
            ...(r.blocosDeWindows !== undefined ? { blocosDeWindows: [...r.blocosDeWindows] } : {}),
            ...(r.precisaDaPlataforma ? { precisaDaPlataforma: true } : {}),
        })),
    };
}
const ehObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
export function problemaDoManifesto(m: unknown): string | undefined {
    if (!ehObjeto(m))
        return 'o manifesto não é um objeto';
    if (m.contrato !== CONTRATO_DO_PACOTE)
        return `contrato ${String(m.contrato)} — esta casca entende o ${CONTRATO_DO_PACOTE}`;
    if (typeof m.organizacao !== 'string' || !ORGANIZACAO.test(m.organizacao))
        return 'organização ausente ou inválida (minúsculas, números e hífen)';
    if (typeof m.commit !== 'string' || !COMMIT.test(m.commit))
        return 'commit ausente ou inválido';
    if (!Array.isArray(m.robos) || m.robos.length === 0)
        return 'o manifesto não traz robô nenhum';
    const vistos = new Set<string>();
    for (const r of m.robos) {
        if (!ehObjeto(r) || typeof r.nome !== 'string' || !NOME_DE_ROBO.test(r.nome))
            return 'robô sem nome válido no manifesto';
        if (vistos.has(r.nome))
            return `robô repetido no manifesto: ${r.nome}`;
        vistos.add(r.nome);
        if (r.executor !== undefined && typeof r.executor !== 'string')
            return `${r.nome}: executor inválido`;
        if (r.blocosDeWindows !== undefined && (!Array.isArray(r.blocosDeWindows) || !r.blocosDeWindows.every((b) => typeof b === 'string'))) {
            return `${r.nome}: blocosDeWindows inválido`;
        }
    }
    return undefined;
}
export function problemaDoPacote(p: unknown): string | undefined {
    if (!ehObjeto(p))
        return 'o pacote não exporta um objeto';
    const doManifesto = problemaDoManifesto(p.manifesto);
    if (doManifesto)
        return `manifesto: ${doManifesto}`;
    if (!Array.isArray(p.robos))
        return 'o pacote não exporta a lista de robôs';
    const nomes = new Set((p.manifesto as ManifestoDoPacote).robos.map((r) => r.nome));
    const vieram = new Set<string>();
    for (const r of p.robos as unknown[]) {
        if (!ehObjeto(r) || typeof r.nome !== 'string')
            return 'robô sem nome no pacote';
        if (!nomes.has(r.nome))
            return `o robô ${r.nome} veio no pacote mas não está no manifesto`;
        if (typeof r.executar !== 'function')
            return `o robô ${r.nome} não sabe executar`;
        vieram.add(r.nome);
    }
    const faltam = [...nomes].filter((n) => !vieram.has(n));
    if (faltam.length)
        return `o manifesto lista robô que não veio no pacote: ${faltam.join(', ')}`;
    if (p.interpretarMontagem !== undefined && typeof p.interpretarMontagem !== 'function')
        return 'interpretarMontagem veio e não é função';
    if (p.dadosDaMaquina !== undefined) {
        const d = problemaDosDadosDaMaquina(p.dadosDaMaquina);
        if (d)
            return `dados da máquina: ${d}`;
    }
    return undefined;
}
