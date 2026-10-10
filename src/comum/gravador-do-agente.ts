import type { GravadorDoAgente } from './atender-ordem.js';
import { gravarNoWindows } from './capturador-janela.js';
import { gravarPelaOrdem, ignorarNaGravacao, lerPedidoDeGravacao } from './sessao-de-gravacao.js';
import { abrirBarraDaGravacao } from './barra-da-gravacao.js';
import { registrar } from './log.js';
export interface MundoDoGravador {
    sessaoZero(): Promise<boolean>;
    areaDeTrabalho(): Promise<boolean>;
    programaDoAgente: string;
    ambiente?: Readonly<Record<string, string | undefined>>;
    existe?(caminho: string): boolean;
    gravarJanelas?: typeof gravarNoWindows;
    abrirBarra?: typeof abrirBarraDaGravacao;
    intervaloMs?: number;
}
const MOTIVOS = { parar: 'parada no Studio', fechou: 'navegador fechado', limite: 'limite de tempo', barra: 'parada na barra' } as const;
export function gravadorDoAgente(m: MundoDoGravador): GravadorDoAgente {
    const ganchos = m.gravarJanelas ?? gravarNoWindows;
    const barraDeVerdade = m.abrirBarra ?? abrirBarraDaGravacao;
    return {
        gravar: async (argumento, parcial) => {
            const lido = lerPedidoDeGravacao(argumento);
            if ('problema' in lido)
                throw new Error(lido.problema);
            if (await m.sessaoZero()) {
                throw new Error('este agente roda na sessão 0 (sem a tela de ninguém): gravar precisa do agente na sessão de quem está ' +
                    'usando o computador — os ganchos não ouviriam nada.');
            }
            if (!(await m.areaDeTrabalho())) {
                throw new Error('este computador está sem área de trabalho agora (tela bloqueada?): desbloqueie e grave de novo.');
            }
            const proprios = new Set<number>();
            let eventos = 0;
            const r = await gravarPelaOrdem({ janelas: true }, {
                abrirBarra: async () => {
                    const b = await barraDeVerdade();
                    if (b.processo)
                        proprios.add(b.processo);
                    return b;
                },
                gravarJanelas: async (aoAtualizar) => {
                    const w = await ganchos({ ignorar: ignorarNaGravacao(m.programaDoAgente, proprios), aoAtualizar });
                    return {
                        parar: async () => {
                            const fim = await w.parar();
                            eventos = fim.eventos;
                            return fim;
                        },
                    };
                },
                parcial,
                agora: Date.now,
                esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
                ...(m.intervaloMs ? { intervaloMs: m.intervaloMs } : {}),
            });
            registrar('info', 'gravação terminada', {
                acoes: r.acoes.length,
                acoesWeb: r.acoes.filter((a) => a.tipo.startsWith('web.')).length,
                eventosDoWindows: eventos,
                motivo: r.motivo,
                entregue: r.entregue,
            });
            if (!r.entregue) {
                throw new Error(`gravei ${r.acoes.length} ação(ões), mas não consegui entregá-las ao painel depois de 3 tentativas — ` +
                    'a gravação não fica neste computador: grave de novo.');
            }
            return `${r.acoes.length} ação(ões) gravada(s) e entregue(s) ao painel (${MOTIVOS[r.motivo]}).`;
        },
    };
}
