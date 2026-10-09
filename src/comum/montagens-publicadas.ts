import { ORGANIZACAO, VERSAO } from './montagens.js';
import type { ManifestoDoPacote } from './pacote-de-robos.js';
export interface MontagensAnunciadas {
    organizacao: string;
    versao: string;
    robos: number;
}
export function montagensAnunciadasValidas(x: unknown): MontagensAnunciadas | undefined {
    if (typeof x !== 'object' || x === null)
        return undefined;
    const m = x as Record<string, unknown>;
    if (typeof m.organizacao !== 'string' || !ORGANIZACAO.test(m.organizacao))
        return undefined;
    if (typeof m.versao !== 'string' || !VERSAO.test(m.versao))
        return undefined;
    if (typeof m.robos !== 'number' || !Number.isInteger(m.robos) || m.robos < 0)
        return undefined;
    return { organizacao: m.organizacao, versao: m.versao, robos: m.robos };
}
type RoboDoManifesto = ManifestoDoPacote['robos'][number];
export function manifestoComMontagens(manifesto: ManifestoDoPacote | undefined, dasMontagens: readonly RoboDoManifesto[]): ManifestoDoPacote | undefined {
    if (!manifesto)
        return undefined;
    const doPacote = new Set(manifesto.robos.map((r) => r.nome));
    return { ...manifesto, robos: [...manifesto.robos, ...dasMontagens.filter((r) => !doPacote.has(r.nome))] };
}
