export interface Versao {
    commit: string;
    construida: string;
}
export const VERSAO: Versao = {
    commit: process.env.VERSAO_COMMIT || 'desenvolvimento',
    construida: process.env.VERSAO_DATA || '',
};
const PREFIXO_DE_AGENTE = 'agente:';
export const nomeDeComponenteDoAgente = (nome: string): string => `${PREFIXO_DE_AGENTE}${nome}`;
export const agenteDoComponente = (componente: string): string | undefined => componente.startsWith(PREFIXO_DE_AGENTE)
    ? componente.slice(PREFIXO_DE_AGENTE.length)
    : undefined;
export function versaoLegivel(v: Versao = VERSAO): string {
    if (!v.construida)
        return v.commit;
    const d = new Date(v.construida);
    if (Number.isNaN(d.getTime()))
        return v.commit;
    return `${v.commit} · ${d.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
    })}`;
}
export const MINIMO_DO_CARIMBO = 7;
export const mesmoCommit = (a: string | undefined, b: string | undefined): boolean => {
    const x = (a ?? '').trim().toLowerCase();
    const y = (b ?? '').trim().toLowerCase();
    if (x.length < MINIMO_DO_CARIMBO || y.length < MINIMO_DO_CARIMBO)
        return false;
    return x.startsWith(y) || y.startsWith(x);
};
