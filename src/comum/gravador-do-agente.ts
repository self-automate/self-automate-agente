import type { GravadorDoAgente } from './atender-ordem.js';
import { gravarNoWindows } from './capturador-janela.js';
import { abrirNavegadorDaGravacao, escolherNavegadorDaGravacao, trazerParaFrente } from './navegador-da-gravacao.js';
import { gravarPelaOrdem, ignorarNaGravacao, lerPedidoDeGravacao, noNavegadorComum } from './sessao-de-gravacao.js';
import { abrirBarraDaGravacao } from './barra-da-gravacao.js';
import { registrar } from './log.js';
export const PAGINA_INICIAL = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Gravando — Self Automate</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#fafafa;color:#222}
main{max-width:560px;text-align:center}h1{font-size:22px}p{font-size:15px;line-height:1.5}.seta{font-size:28px}</style></head>
<body><main><div class="seta">↑</div><h1>Esta é a janela de gravação</h1>
<p>Digite o endereço do site na barra de endereço, lá em cima, e faça o processo aqui, como sempre faz.</p>
<p>Os programas do computador também são gravados. O que você fizer no seu Chrome de sempre <b>não</b> entra.</p>
<p>Para terminar, aperte <b>Parar</b> na barra vermelha.</p></main></body></html>`;
export interface MundoDoGravador {
    sessaoZero(): Promise<boolean>;
    areaDeTrabalho(): Promise<boolean>;
    programaDoAgente: string;
    ambiente: Readonly<Record<string, string | undefined>>;
    existe(caminho: string): boolean;
    abrirNavegador?: typeof abrirNavegadorDaGravacao;
    gravarJanelas?: typeof gravarNoWindows;
    abrirBarra?: typeof abrirBarraDaGravacao;
    trazerParaFrente?: typeof trazerParaFrente;
    intervaloMs?: number;
}
const MOTIVOS = { parar: 'parada no Studio', fechou: 'navegador fechado', limite: 'limite de tempo', barra: 'parada na barra' } as const;
export function gravadorDoAgente(m: MundoDoGravador): GravadorDoAgente {
    const abrir = m.abrirNavegador ?? abrirNavegadorDaGravacao;
    const ganchos = m.gravarJanelas ?? gravarNoWindows;
    const barraDeVerdade = m.abrirBarra ?? abrirBarraDaGravacao;
    const paraFrente = m.trazerParaFrente ?? trazerParaFrente;
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
            const proprios = new Set<number>();
            let foraDaGravacao = 0;
            let eventos = 0;
            const r = await gravarPelaOrdem(lido.pedido, {
                abrirBarra: async () => {
                    const b = await barraDeVerdade();
                    if (b.processo)
                        proprios.add(b.processo);
                    return b;
                },
                abrirWeb: async (endereco, aoGravar, aoGesto) => {
                    const escolha = escolherNavegadorDaGravacao(m.ambiente, m.existe);
                    if ('falta' in escolha)
                        throw new Error(escolha.falta);
                    const g = await abrir(escolha, aoGravar, aoGesto);
                    if (g.processo)
                        proprios.add(g.processo);
                    if (endereco)
                        await g.pagina.goto(endereco).catch(() => undefined);
                    else
                        await g.pagina.setContent(PAGINA_INICIAL).catch(() => undefined);
                    const frente = await paraFrente(g.processo).catch((erro: unknown) => `não trouxe: ${String(erro).slice(0, 200)}`);
                    registrar('info', 'janela da gravação', { frente });
                    return { fechado: g.fechado, parar: g.parar, ...(escolha.aviso ? { aviso: escolha.aviso } : {}) };
                },
                gravarJanelas: async (aoAtualizar) => {
                    const w = await ganchos({ ignorar: ignorarNaGravacao(m.programaDoAgente, proprios), fora: noNavegadorComum(proprios), aoAtualizar });
                    return {
                        parar: async () => {
                            const fim = await w.parar();
                            foraDaGravacao = fim.foraDaGravacao;
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
                eventosDoWindows: eventos,
                noNavegadorComum: foraDaGravacao,
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
