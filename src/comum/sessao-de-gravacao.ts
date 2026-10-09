import { somarNaoGravados, type AcaoGravada, type GestoNaoGravado, type NaoGravados } from './gravacao.js';
import type { ElementoNaTela } from './capturador-janela.js';
export interface PedidoDeGravacao {
    endereco?: string;
    janelas: boolean;
}
export function lerPedidoDeGravacao(argumento: string): {
    pedido: PedidoDeGravacao;
} | {
    problema: string;
} {
    let o: unknown;
    try {
        o = JSON.parse(argumento);
    }
    catch {
        return { problema: 'o pedido de gravação não é JSON' };
    }
    if (!o || typeof o !== 'object' || Array.isArray(o))
        return { problema: 'o pedido de gravação não é um objeto' };
    const { endereco, janelas } = o as Record<string, unknown>;
    const pedido: PedidoDeGravacao = { janelas: janelas === true };
    if (endereco !== undefined) {
        let url: URL;
        try {
            url = new URL(String(endereco));
        }
        catch {
            return { problema: 'o endereço inicial não é um endereço' };
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return { problema: 'o endereço inicial tem de começar com http:// ou https://' };
        }
        pedido.endereco = String(endereco);
    }
    if (!pedido.endereco && !pedido.janelas)
        return { problema: 'gravar o quê? Falta o endereço, ou marcar as janelas do Windows' };
    return { pedido };
}
export interface AcaoCarimbada {
    acao: AcaoGravada;
    em: number;
}
export function juntarAcoes(web: AcaoCarimbada[], janela: AcaoCarimbada[]): AcaoGravada[] {
    return [...web.map((c, i) => ({ ...c, lado: 0, i })), ...janela.map((c, i) => ({ ...c, lado: 1, i }))]
        .sort((a, b) => a.em - b.em || a.lado - b.lado || a.i - b.i)
        .map((c) => c.acao);
}
const NAVEGADORES = ['chrome', 'msedge', 'firefox', 'opera', 'brave', 'iexplore'];
export function ignorarNaGravacao(programaDoAgente: string): (el: ElementoNaTela) => boolean {
    const fora = new Set([...NAVEGADORES, programaDoAgente.toLowerCase()]);
    return (el) => !!el.programa && fora.has(el.programa.toLowerCase());
}
export interface NavegadorAberto {
    fechado: Promise<void>;
    parar(): Promise<void>;
    aviso?: string;
}
export interface JanelasGravando {
    parar(): Promise<{
        acoes: AcaoGravada[];
        momentos: number[];
        semAlvo: number;
        naoGravados?: NaoGravados;
    }>;
}
export interface MundoDaGravacao {
    abrirWeb?(endereco: string, aoGravar: (acao: AcaoGravada) => void, aoGesto?: (g: GestoNaoGravado) => void): Promise<NavegadorAberto>;
    gravarJanelas?(aoAtualizar: (montada: {
        acoes: AcaoGravada[];
        momentos: number[];
        naoGravados?: NaoGravados;
    }) => void): Promise<JanelasGravando>;
    parcial(acoes: AcaoGravada[], avisos: string[], fim?: boolean, naoGravados?: NaoGravados): Promise<{
        parar: boolean;
    }>;
    agora(): number;
    esperar(ms: number): Promise<void>;
    limiteMs?: number;
    intervaloMs?: number;
}
export const LIMITE_DA_GRAVACAO_MS = 30 * 60000;
export const TETO_DA_GRAVACAO = 1024 * 1024;
const TENTATIVAS_DA_FINAL = 3;
export interface ResultadoDaGravacao {
    acoes: AcaoGravada[];
    avisos: string[];
    motivo: 'parar' | 'fechou' | 'limite';
    entregue: boolean;
    naoGravados: NaoGravados;
}
function caber(acoes: AcaoGravada[], avisos: string[]): AcaoGravada[] {
    const folga = 4000;
    let total = JSON.stringify({ acoes: [], avisos, fim: true }).length + folga;
    let cabem = 0;
    for (const a of acoes) {
        const n = JSON.stringify(a).length + 1;
        if (total + n > TETO_DA_GRAVACAO)
            break;
        total += n;
        cabem++;
    }
    if (cabem === acoes.length)
        return acoes;
    avisos.push(`A gravação foi cortada: só as primeiras ${cabem} de ${acoes.length} ações cabem num envio. Grave o resto em outra gravação.`);
    return acoes.slice(0, cabem);
}
async function entregar(mundo: MundoDaGravacao, acoes: AcaoGravada[], avisos: string[], intervalo: number, naoGravados: NaoGravados): Promise<boolean> {
    for (let i = 0; i < TENTATIVAS_DA_FINAL; i++) {
        try {
            await mundo.parcial(acoes, avisos, true, naoGravados);
            return true;
        }
        catch {
            if (i < TENTATIVAS_DA_FINAL - 1)
                await mundo.esperar(intervalo);
        }
    }
    return false;
}
export async function gravarPelaOrdem(pedido: PedidoDeGravacao, mundo: MundoDaGravacao): Promise<ResultadoDaGravacao> {
    const limite = mundo.limiteMs ?? LIMITE_DA_GRAVACAO_MS;
    const intervalo = mundo.intervaloMs ?? 1500;
    const avisos: string[] = [];
    const web: AcaoCarimbada[] = [];
    if (pedido.janelas && !mundo.gravarJanelas)
        throw new Error('este agente não grava janelas do Windows');
    if (pedido.endereco && !mundo.abrirWeb)
        throw new Error('este agente não grava no navegador');
    try {
        if ((await mundo.parcial([], avisos)).parar) {
            return { acoes: [], avisos, motivo: 'parar', naoGravados: {}, entregue: await entregar(mundo, [], avisos, intervalo, {}) };
        }
    }
    catch {
    }
    let aoVivo: AcaoCarimbada[] = [];
    const carimbar = (m: {
        acoes: AcaoGravada[];
        momentos: number[];
    }): AcaoCarimbada[] => m.acoes.map((acao, i) => ({ acao, em: m.momentos[i] ?? 0 }));
    let gestosDaWeb: NaoGravados = {};
    let gestosDasJanelas: NaoGravados = {};
    const janelas = pedido.janelas
        ? await mundo.gravarJanelas!((m) => {
            aoVivo = carimbar(m);
            gestosDasJanelas = m.naoGravados ?? {};
        })
        : undefined;
    let navegador: NavegadorAberto | undefined;
    try {
        if (pedido.endereco) {
            navegador = await mundo.abrirWeb!(pedido.endereco, (acao) => web.push({ acao, em: mundo.agora() }), (g) => (gestosDaWeb = somarNaoGravados(gestosDaWeb, { [g]: 1 })));
            if (navegador.aviso)
                avisos.push(navegador.aviso);
        }
    }
    catch (erro) {
        await janelas?.parar().catch(() => undefined);
        throw erro;
    }
    let fechou = false;
    void navegador?.fechado.then(() => (fechou = true));
    const inicio = mundo.agora();
    let motivo: ResultadoDaGravacao['motivo'];
    for (;;) {
        await mundo.esperar(intervalo);
        let parar = false;
        try {
            parar = (await mundo.parcial(juntarAcoes(web, aoVivo), avisos, false, somarNaoGravados(gestosDaWeb, gestosDasJanelas))).parar;
        }
        catch {
        }
        if (parar) {
            motivo = 'parar';
            break;
        }
        if (fechou) {
            motivo = 'fechou';
            break;
        }
        if (mundo.agora() - inicio >= limite) {
            motivo = 'limite';
            avisos.push(`A gravação parou sozinha no limite de ${Math.round(limite / 60000)} minutos.`);
            break;
        }
    }
    const [, doWindows] = await Promise.all([
        navegador?.parar().catch(() => undefined),
        janelas?.parar(),
    ]);
    const janela = doWindows ? carimbar(doWindows) : [];
    if (doWindows && doWindows.semAlvo > 0) {
        avisos.push(`${doWindows.semAlvo} gesto(s) no Windows ficaram de fora: o elemento não tinha identificador nem nome, e coordenada não é alvo.`);
    }
    const acoes = caber(juntarAcoes(web, janela), avisos);
    const naoGravados = somarNaoGravados(gestosDaWeb, doWindows?.naoGravados ?? {});
    return { acoes, avisos, motivo, naoGravados, entregue: await entregar(mundo, acoes, avisos, intervalo, naoGravados) };
}
