import { executarRoboComAcompanhamento, alertaDoAmbiente } from './comum/executar.js';
import { BLOCOS_COM_CANAL_PROVADO, BLOCOS_PROVADOS_COM_AREA_DE_TRABALHO, EXECUTORES_CONHECIDOS, blocoProvado, oAgenteServe, type CapacidadesDoAgente, } from './comum/quem-o-agente-serve.js';
import { registrar } from './comum/log.js';
import { acompanharBatimento, SILENCIO_ATE_REINICIAR_MS } from './comum/reinicio-do-agente.js';
import type { Pedido, Transporte } from './comum/transporte-tipos.js';
import { VERSAO } from './comum/versao.js';
import type { Cofre } from './comum/cofre.js';
import type { Robo } from './robo.js';
import { atenderOrdem, type CanalDeOrdens, type CelularDoAgente, type GravadorDoAgente } from './comum/atender-ordem.js';
import type { AcessoDaMaquina } from './comum/catalogo-de-leitura.js';
import { contaWindowsDoProcesso } from './comum/contas-de-execucao.js';
import type { PacoteAnunciado } from './comum/pacote-de-robos.js';
import type { MontagensAnunciadas } from './comum/montagens-publicadas.js';
export interface DependenciasDoTique {
    transporte: Transporte;
    reiniciar: (contexto: {
        robosRodando: string[];
    }) => void;
    cofreDoJob: (id: string) => Cofre;
    robos: Robo[];
    rodando: Set<string>;
    concorrencia?: number;
    areaDeTrabalho?: () => Promise<boolean>;
    telaNaSessao?: () => Promise<boolean>;
    pacoteDeRobos?: () => PacoteAnunciado | undefined;
    montagens?: () => MontagensAnunciadas | undefined;
    onde: string;
    canal: CanalDeOrdens;
    acesso: AcessoDaMaquina;
    atualizacao: (versao: string) => Promise<string>;
    aoLancar?: (execucao: Promise<unknown>, robo: string) => void;
    executar?: (id: string, robo: Robo, pedido?: Pedido) => Promise<unknown>;
    cancelar?: (execucaoId: string) => Promise<string>;
    celular?: CelularDoAgente;
    gravador?: GravadorDoAgente;
}
async function recusarSemOrfa(transporte: Transporte, id: string, motivo: string): Promise<void> {
    await transporte.fecharExecucao(id, 'FALHOU', new Date(), motivo);
}
let falhasSeguidas = 0;
let ultimoSucessoEm = Date.now();
async function carimbarVersao(transporte: Transporte, onde: string, reiniciar: () => void, capacidades: CapacidadesDoAgente): Promise<void> {
    const r = await acompanharBatimento(() => transporte.baterPonto(onde, VERSAO, capacidades), {
        falhasSeguidas,
        ultimoSucessoEm,
        limiteMs: SILENCIO_ATE_REINICIAR_MS,
    });
    if (r.restabelecido)
        registrar('info', 'batimento restabelecido', { falhasSeguidas });
    falhasSeguidas = r.falhasSeguidas;
    ultimoSucessoEm = r.ultimoSucessoEm;
    if (falhasSeguidas === 0)
        return;
    if (falhasSeguidas === 1 || falhasSeguidas % 12 === 0 || r.decisao.reiniciar) {
        registrar(r.decisao.reiniciar ? 'erro' : 'aviso', 'falha ao carimbar a versão do agente — o tique segue', {
            falhasSeguidas,
            motivo: r.decisao.motivo,
        });
    }
    if (r.decisao.reiniciar)
        reiniciar();
}
export function motivoDaRecusa(robo: {
    nome: string;
    executor?: string;
    blocosDeWindows?: readonly string[];
}, capacidades: CapacidadesDoAgente = {}): string {
    const alvo = `Robô "${robo.nome}"`;
    if (!robo.executor) {
        return (`${alvo} não declara executor. Ausência de rótulo é recusa: quem não decidiu, não passa — ` +
            'e um robô sem rótulo rodando seria decisão tomada por omissão.');
    }
    if (!EXECUTORES_CONHECIDOS.has(robo.executor)) {
        const conhecidos = [...EXECUTORES_CONHECIDOS].sort().join('`, `');
        return `${alvo} declara executor \`${robo.executor}\`, que não existe. Os rótulos são \`${conhecidos}\`.`;
    }
    const blocos = robo.blocosDeWindows ?? [];
    const provados = [...BLOCOS_COM_CANAL_PROVADO].sort().join('`, `');
    if (blocos.length === 0) {
        return (`${alvo} declara \`agente-windows\` e não declara bloco nenhum. Sem saber o que ele toca ` +
            'não há como afirmar que este agente o alcança, então a recusa é por ausência, não por ' +
            'conteúdo. O campo `blocosDeWindows` é emitido pelo motor a partir dos importes.');
    }
    const semCanal = blocos.filter((b) => !blocoProvado(b, capacidades));
    if (semCanal.length > 0 && semCanal.every((b) => BLOCOS_PROVADOS_COM_AREA_DE_TRABALHO.has(b))) {
        return (`${alvo} toca \`${semCanal.join('`, `')}\`, que só roda numa sessão com área de trabalho ` +
            'desbloqueada, e este agente não está numa: roda sem área de trabalho (tarefa "conectado ou não") ' +
            'ou com a tela bloqueada.');
    }
    return (`${alvo} toca \`${semCanal.join('`, `')}\`, e esse canal não foi provado neste agente. ` +
        `Provados hoje: \`${provados}\`. Provar um canal é medir na máquina do cliente, ` +
        'não acrescentar o nome à lista.');
}
export const usaTela = (r: Pick<Robo, 'blocosDeWindows'> | undefined): boolean => (r?.blocosDeWindows ?? []).includes('tela');
export async function umTique(d: DependenciasDoTique): Promise<'vazio' | 'executou' | 'recusado' | 'ordem' | 'ocupado'> {
    const capacidades: CapacidadesDoAgente = {
        areaDeTrabalho: d.areaDeTrabalho ? await d.areaDeTrabalho() : false,
        telaNaSessao: d.telaNaSessao ? await d.telaNaSessao() : false,
        contaWindows: contaWindowsDoProcesso(),
        pacoteDeRobos: d.pacoteDeRobos?.(),
        montagens: d.montagens?.(),
    };
    await carimbarVersao(d.transporte, d.onde, () => d.reiniciar({ robosRodando: [...d.rodando].sort() }), capacidades);
    if ((await atenderOrdem(d.canal, d.acesso, d.atualizacao, d.cancelar, d.celular, d.gravador)) === 'atendida')
        return 'ordem';
    const limite = d.concorrencia && d.concorrencia >= 1 ? d.concorrencia : 1;
    if (d.rodando.size >= limite)
        return 'ocupado';
    if ([...d.rodando].some((nome) => usaTela(d.robos.find((r) => r.nome === nome))))
        return 'ocupado';
    const disponiveis = d.robos
        .filter((r) => oAgenteServe(r, capacidades))
        .filter((r) => !d.rodando.has(r.nome))
        .filter((r) => d.rodando.size === 0 || !usaTela(r))
        .map((r) => r.nome);
    const pedido = await d.transporte.retirarPedido(disponiveis);
    if (!pedido)
        return 'vazio';
    if (!pedido.id) {
        registrar('aviso', 'pedido sem id de execução — anomalia do painel, recusado sem tocar em nenhuma execução', {
            robo: pedido.robo,
        });
        return 'recusado';
    }
    const robo = d.robos.find((r) => r.nome === pedido.robo);
    if (!robo) {
        registrar('aviso', 'painel ofereceu robô que este agente não conhece', { robo: pedido.robo });
        await recusarSemOrfa(d.transporte, pedido.id, `Robô "${pedido.robo}" não existe no registro deste agente.`);
        return 'recusado';
    }
    if (!oAgenteServe(robo, capacidades)) {
        registrar('aviso', 'robô recusado: este agente não o serve', {
            robo: robo.nome,
            executor: robo.executor ?? '(sem rótulo)',
        });
        await recusarSemOrfa(d.transporte, pedido.id, motivoDaRecusa(robo, capacidades));
        return 'recusado';
    }
    if (d.rodando.has(robo.nome)) {
        registrar('aviso', 'robô já em execução — pedido recusado para não rodar em paralelo consigo mesmo', {
            robo: robo.nome,
        });
        await recusarSemOrfa(d.transporte, pedido.id, `Robô "${robo.nome}" já está em execução neste agente.`);
        return 'recusado';
    }
    d.rodando.add(robo.nome);
    {
        const execucao = (d.executar
            ? d.executar(pedido.id, robo, pedido)
            : executarRoboComAcompanhamento(d.transporte, d.cofreDoJob(pedido.id), robo, d.onde, alertaDoAmbiente()))
            .then(() => registrar('info', 'robô terminou', { robo: robo.nome, por: pedido.por }))
            .catch((erro: unknown) => registrar('erro', 'a execução caiu fora do tique', { robo: robo.nome, motivo: erro instanceof Error ? erro.message : String(erro) }))
            .finally(() => d.rodando.delete(robo.nome));
        d.aoLancar?.(execucao, robo.nome);
        return 'executou';
    }
}
export async function executarJob(p: {
    transporte: Transporte;
    cofre: Cofre;
    robo: Robo;
    onde: string;
    id: string;
}): Promise<void> {
    const transporte: Transporte = { ...p.transporte, abrirExecucao: async () => p.id };
    await transporte.marcarPasso(p.id, `iniciando no processo filho ${process.pid}`).catch(() => undefined);
    await executarRoboComAcompanhamento(transporte, p.cofre, p.robo, p.onde, alertaDoAmbiente());
}
