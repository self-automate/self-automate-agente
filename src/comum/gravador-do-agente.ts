import type { GravadorDoAgente } from './atender-ordem.js';
import { gravarNoWindows } from './capturador-janela.js';
import { abrirNavegadorDaGravacao, escolherNavegadorDaGravacao } from './navegador-da-gravacao.js';
import { gravarPelaOrdem, ignorarNaGravacao, lerPedidoDeGravacao } from './sessao-de-gravacao.js';
export interface MundoDoGravador {
    sessaoZero(): Promise<boolean>;
    areaDeTrabalho(): Promise<boolean>;
    programaDoAgente: string;
    ambiente: Readonly<Record<string, string | undefined>>;
    existe(caminho: string): boolean;
    abrirNavegador?: typeof abrirNavegadorDaGravacao;
    gravarJanelas?: typeof gravarNoWindows;
    intervaloMs?: number;
}
const MOTIVOS = { parar: 'parada no Studio', fechou: 'navegador fechado', limite: 'limite de tempo' } as const;
export function gravadorDoAgente(m: MundoDoGravador): GravadorDoAgente {
    const abrir = m.abrirNavegador ?? abrirNavegadorDaGravacao;
    const ganchos = m.gravarJanelas ?? gravarNoWindows;
    return {
        gravar: async (argumento, parcial) => {
            const lido = lerPedidoDeGravacao(argumento);
            if ('problema' in lido)
                throw new Error(lido.problema);
            if (await m.sessaoZero()) {
                throw new Error('este agente roda na sessão 0 (sem a tela de ninguém): gravar precisa do agente na sessão de quem está ' +
                    'usando o computador — os ganchos não ouviriam nada e o navegador abriria onde ninguém vê.');
            }
            if (!(await m.areaDeTrabalho())) {
                throw new Error('este computador está sem área de trabalho agora (tela bloqueada?): desbloqueie e grave de novo.');
            }
            const r = await gravarPelaOrdem(lido.pedido, {
                abrirWeb: async (endereco, aoGravar, aoGesto) => {
                    const escolha = escolherNavegadorDaGravacao(m.ambiente, m.existe);
                    if ('falta' in escolha)
                        throw new Error(escolha.falta);
                    const g = await abrir(escolha, aoGravar, aoGesto);
                    await g.pagina.goto(endereco).catch(() => undefined);
                    return { fechado: g.fechado, parar: g.parar, ...(escolha.aviso ? { aviso: escolha.aviso } : {}) };
                },
                gravarJanelas: async (aoAtualizar) => {
                    const w = await ganchos({ ignorar: ignorarNaGravacao(m.programaDoAgente), aoAtualizar });
                    return { parar: () => w.parar() };
                },
                parcial,
                agora: Date.now,
                esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
                ...(m.intervaloMs ? { intervaloMs: m.intervaloMs } : {}),
            });
            if (!r.entregue) {
                throw new Error(`gravei ${r.acoes.length} ação(ões), mas não consegui entregá-las ao painel depois de 3 tentativas — ` +
                    'a gravação não fica neste computador: grave de novo.');
            }
            return `${r.acoes.length} ação(ões) gravada(s) e entregue(s) ao painel (${MOTIVOS[r.motivo]}).`;
        },
    };
}
