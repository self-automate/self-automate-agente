import type { JanelaDeRmReportada, PedidoDeColeta } from './janelas-de-rm-tipos.js';
import type { AlcanceDeDestino } from './alcance-de-destino.js';
import type { AcessoACredencial } from './acesso-a-credencial.js';
import type { Versao } from './versao.js';
import type { CapacidadesDoAgente } from './quem-o-agente-serve.js';
import type { ContaDoJob } from './contas-de-execucao.js';
export interface Pedido {
    robo: string;
    por: string;
    id?: IdExecucao;
    validacao?: {
        pedido: number;
        caixa: string;
        dominios?: string[];
    };
    conta?: ContaDoJob;
}
export type IdExecucao = string;
export interface Transporte {
    retirarPedido(robos: string[]): Promise<Pedido | undefined>;
    abrirExecucao(robo: string, inicio: Date, onde: string): Promise<IdExecucao>;
    marcarPasso(id: IdExecucao, passo: string, feito?: number, total?: number): Promise<void>;
    fecharExecucao(id: IdExecucao, status: 'CONCLUIDO' | 'FALHOU' | 'CANCELADA', fim: Date, mensagem: string): Promise<void>;
    baterPonto(componente: string, versao: Versao, capacidades?: CapacidadesDoAgente): Promise<boolean>;
    reportarAlcance?(id: IdExecucao, destinos: readonly AlcanceDeDestino[]): Promise<number>;
    reportarJanelaDeRm?(id: IdExecucao, janela: JanelaDeRmReportada): Promise<{
        id: number;
        nova: boolean;
    }>;
    coletasPendentes?(id: IdExecucao): Promise<PedidoDeColeta[]>;
    reportarColeta?(id: IdExecucao, coletaId: number, resultados: readonly unknown[]): Promise<void>;
    anexarAColeta?(id: IdExecucao, coletaId: number, rm: string, nome: string, bytes: Buffer): Promise<void>;
    anotarAcessoACredencial?(acesso: AcessoACredencial): Promise<void>;
    credencialPessoal?(job: IdExecucao, caminho: string): Promise<Record<string, string>>;
}
