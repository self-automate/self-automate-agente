import type { JanelaDeRmReportada } from './janelas-de-rm-tipos.js';
import type { AlcanceDeDestino } from './alcance-de-destino.js';
import { registrar } from './log.js';
import { caixaDaFerramenta, despachar } from './email.js';
import type { Transporte } from './transporte-tipos.js';
import type { Cofre } from './cofre.js';
import { cofreAuditado } from './cofre-auditado.js';
import { cofreComCredencialPessoal } from './credencial-pessoal-pelo-console.js';
import type { Robo } from '../robo.js';
export interface Resultado {
    status: 'CONCLUIDO' | 'FALHOU';
    mensagem: string;
}
export interface Alerta {
    para: string[];
    despachar: (m: {
        para: string[];
        assunto: string;
        corpo: string;
    }, cofre: Cofre) => Promise<unknown>;
}
export function alertaDoAmbiente(): Alerta {
    const para = (process.env.ALERTA_PARA ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    const caixa = caixaDaFerramenta() ? ('ferramenta' as const) : undefined;
    return { para, despachar: (m, cofre) => despachar(m, cofre, undefined, undefined, undefined, caixa) };
}
export const PRAZO_DO_DRENO_MS = 5000;
export async function executarRoboComAcompanhamento(transporte: Transporte, cofre: Cofre, robo: Robo, onde: string, alerta?: Alerta): Promise<Resultado> {
    const inicio = new Date();
    const id = await transporte.abrirExecucao(robo.nome, inicio, onde);
    const emVoo = new Set<Promise<void>>();
    const anotar = (passo: string, feito?: number, total?: number) => {
        const p: Promise<void> = transporte
            .marcarPasso(id, passo, feito, total)
            .catch(() => undefined)
            .finally(() => {
            emVoo.delete(p);
        });
        emVoo.add(p);
    };
    const drenar = async (): Promise<void> => {
        if (emVoo.size === 0)
            return;
        let alarme: ReturnType<typeof setTimeout> | undefined;
        const prazo = new Promise<void>((resolve) => {
            alarme = setTimeout(resolve, PRAZO_DO_DRENO_MS);
        });
        try {
            await Promise.race([Promise.all([...emVoo]).then(() => undefined), prazo]);
        }
        finally {
            if (alarme !== undefined)
                clearTimeout(alarme);
        }
    };
    const cofreDoJob = transporte.anotarAcessoACredencial
        ? cofreAuditado(cofre, (acesso) => transporte.anotarAcessoACredencial!(acesso), {
            agente: onde,
            job: id,
        })
        : cofre;
    const cofreDoRobo = cofreComCredencialPessoal(cofreDoJob, String(id), transporte.credencialPessoal);
    const contexto = {
        cofre: cofreDoRobo,
        registrar: (mensagem: string, dados: Record<string, unknown> = {}) => {
            registrar('info', mensagem, { robo: robo.nome, ...dados });
            anotar(mensagem);
        },
        progresso: (feito: number, total: number) => anotar('', feito, total),
        ...(transporte.reportarAlcance
            ? {
                reportarAlcance: (destinos: readonly AlcanceDeDestino[]) => transporte.reportarAlcance!(id, destinos),
            }
            : {}),
        ...(transporte.reportarJanelaDeRm
            ? {
                reportarJanelaDeRm: (janela: JanelaDeRmReportada) => transporte.reportarJanelaDeRm!(id, janela),
            }
            : {}),
        ...(transporte.coletasPendentes ? { coletasPendentes: () => transporte.coletasPendentes!(id) } : {}),
        ...(transporte.reportarColeta
            ? { reportarColeta: (coletaId: number, resultados: readonly unknown[]) => transporte.reportarColeta!(id, coletaId, resultados) }
            : {}),
        ...(transporte.anexarAColeta
            ? { anexarAColeta: (coletaId: number, rm: string, nome: string, bytes: Buffer) => transporte.anexarAColeta!(id, coletaId, rm, nome, bytes) }
            : {}),
    };
    try {
        const mensagem = await robo.executar(contexto);
        const fim = new Date();
        await drenar();
        await transporte.fecharExecucao(id, 'CONCLUIDO', fim, mensagem);
        registrar('info', 'execução concluída', {
            robo: robo.nome,
            duracaoMs: fim.getTime() - inicio.getTime(),
        });
        return { status: 'CONCLUIDO', mensagem };
    }
    catch (erro) {
        const fim = new Date();
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        await drenar();
        await transporte.fecharExecucao(id, 'FALHOU', fim, mensagem);
        registrar('erro', 'execução falhou', { robo: robo.nome, mensagem });
        if (alerta) {
            if (!alerta.para.length) {
                registrar('aviso', 'alerta de falha NÃO enviado: nenhum destinatário configurado', {
                    robo: robo.nome,
                });
            }
            else {
                try {
                    await alerta.despachar({
                        para: alerta.para,
                        assunto: `[RPA] ${robo.nome} falhou`,
                        corpo: `O robô "${robo.nome}" falhou em ${onde}.\n\n` +
                            `Início: ${inicio.toISOString()}\n` +
                            `Fim: ${fim.toISOString()}\n` +
                            `Duração: ${Math.round((fim.getTime() - inicio.getTime()) / 1000)}s\n\n` +
                            `Motivo:\n${mensagem}\n`,
                    }, cofreDoJob);
                }
                catch (falhaDoAlerta) {
                    registrar('erro', 'alerta de falha não pôde ser enviado', {
                        robo: robo.nome,
                        motivo: falhaDoAlerta instanceof Error ? falhaDoAlerta.message : String(falhaDoAlerta),
                    });
                }
            }
        }
        return { status: 'FALHOU', mensagem };
    }
}
