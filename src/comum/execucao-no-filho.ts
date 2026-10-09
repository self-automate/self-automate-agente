import { registrar } from './log.js';
export const PRAZO_PADRAO_MIN = 30;
export interface FilhoVigiado {
    pid: number | undefined;
    terminou: Promise<{
        codigo: number | null;
        sinal: string | null;
        motivo?: string;
    }>;
    matar(): Promise<void>;
}
export function prazoDoRobo(robo: {
    nome: string;
    prazoMinutos?: number | undefined;
}, env: Record<string, string | undefined>): number {
    if (typeof robo.prazoMinutos === 'number' && Number.isFinite(robo.prazoMinutos))
        return Math.max(0, robo.prazoMinutos);
    const doAmbiente = Number((env.AGENTE_PRAZO_MIN ?? '').trim());
    if ((env.AGENTE_PRAZO_MIN ?? '').trim() !== '' && Number.isFinite(doAmbiente))
        return Math.max(0, doAmbiente);
    return PRAZO_PADRAO_MIN;
}
export type DesfechoNoFilho = 'concluiu' | 'morreu' | 'prazo' | 'cancelado';
export async function executarComPrazo(p: {
    id: string;
    robo: {
        nome: string;
        prazoMinutos?: number | undefined;
    };
    prazoMin: number;
    lancar: () => FilhoVigiado;
    fechar: (id: string, status: 'FALHOU' | 'CANCELADA', mensagem: string) => Promise<void>;
    cancelando: Set<string>;
    filhos: Map<string, {
        robo: string;
        pid: number | undefined;
        matar: () => Promise<void>;
    }>;
    agendar?: (fn: () => void, ms: number) => unknown;
    desagendar?: (alarme: unknown) => void;
}): Promise<DesfechoNoFilho> {
    const agendar = p.agendar ?? ((fn, ms) => setTimeout(fn, ms));
    const desagendar = p.desagendar ?? ((a) => clearTimeout(a as ReturnType<typeof setTimeout>));
    const filho = p.lancar();
    p.filhos.set(p.id, { robo: p.robo.nome, pid: filho.pid, matar: () => filho.matar() });
    let estourou = false;
    let alarme: unknown;
    if (p.prazoMin > 0) {
        alarme = agendar(() => {
            estourou = true;
            registrar('aviso', 'prazo do robô estourou — matando o processo filho', { robo: p.robo.nome, execucao: p.id, prazoMin: p.prazoMin, pid: filho.pid });
            void filho.matar();
        }, p.prazoMin * 60000);
    }
    try {
        const { codigo, sinal, motivo } = await filho.terminou;
        if (alarme !== undefined)
            desagendar(alarme);
        if (estourou) {
            await p.fechar(p.id, 'CANCELADA', `Cancelada pelo agente: estourou o prazo de ${p.prazoMin} min do robô ${p.robo.nome}. ` +
                `Processo ${filho.pid ?? '?'} morto pela árvore. Se o robô precisa de mais tempo, ajuste prazoMinutos no registro dele ou AGENTE_PRAZO_MIN no agente.`);
            return 'prazo';
        }
        if (p.cancelando.has(p.id))
            return 'cancelado';
        if (codigo === 0)
            return 'concluiu';
        await p.fechar(p.id, 'FALHOU', motivo ??
            `O processo do robô morreu sem fechar a execução (código ${codigo ?? 'nulo'}${sinal ? `, sinal ${sinal}` : ''}). Veja o log do agente na máquina.`);
        return 'morreu';
    }
    finally {
        p.filhos.delete(p.id);
        p.cancelando.delete(p.id);
    }
}
