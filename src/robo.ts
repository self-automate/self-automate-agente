import type { AlcanceDeDestino } from './comum/alcance-de-destino.js';
import type { Cofre } from './comum/cofre.js';
import type { JanelaDeRmReportada, PedidoDeColeta } from './comum/janelas-de-rm-tipos.js';
export interface Contexto {
    cofre: Cofre;
    reportarAlcance?(destinos: readonly AlcanceDeDestino[]): Promise<number>;
    reportarJanelaDeRm?(janela: JanelaDeRmReportada): Promise<{
        id: number;
        nova: boolean;
    }>;
    coletasPendentes?(): Promise<PedidoDeColeta[]>;
    reportarColeta?(coletaId: number, resultados: readonly unknown[]): Promise<void>;
    anexarAColeta?(coletaId: number, rm: string, nome: string, bytes: Buffer): Promise<void>;
    registrar(mensagem: string, dados?: Record<string, unknown>): void;
    progresso(feito: number, total: number): void;
}
export type Executor = 'plataforma' | 'agente-windows' | 'android';
export interface Robo {
    nome: string;
    processo?: string;
    prazoMinutos?: number;
    horarioVemDe?: {
        rotulo: string;
        href: string;
    };
    descricao?: string;
    executor?: Executor;
    blocosDeWindows?: readonly string[];
    precisaDaPlataforma?: boolean;
    precisaDaRedeDoCliente?: boolean;
    agendamento?: string;
    executar(ctx: Contexto): Promise<string>;
}
export const rodaNoRunner = (r: Robo): boolean => (r.executor ?? 'plataforma') === 'plataforma' && !r.precisaDaRedeDoCliente;
