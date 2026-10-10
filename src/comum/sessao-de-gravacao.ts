import { descreverAcao, juntarDigitacao, somarNaoGravados, type AcaoGravada, type GestoNaoGravado, type NaoGravados } from './gravacao.js';
import type { ElementoNaTela } from './capturador-janela.js';
export interface PedidoDeGravacao {
    endereco?: string;
    janelas: boolean;
    web?: boolean;
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
    const { endereco, janelas, web } = o as Record<string, unknown>;
    const pedido: PedidoDeGravacao = { janelas: janelas === true, ...(web === true ? { web: true } : {}) };
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
    if (!pedido.endereco && !pedido.janelas && !pedido.web)
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
export function ignorarNaGravacao(programaDoAgente: string, proprios: ReadonlySet<number> = new Set()): (el: ElementoNaTela) => boolean {
    const agente = programaDoAgente.toLowerCase();
    return (el) => (!!el.programa && el.programa.toLowerCase() === agente) || (el.processo !== undefined && proprios.has(el.processo));
}
export function noNavegadorComum(proprios: ReadonlySet<number> = new Set()): (el: ElementoNaTela) => boolean {
    return (el) => !!el.programa &&
        NAVEGADORES.includes(el.programa.toLowerCase()) &&
        !(el.processo !== undefined && proprios.has(el.processo));
}
export interface BarraNaSessao {
    parada: Promise<void>;
    atualizar(estado: {
        acoes: number;
        ultima?: string;
        aviso?: string;
    }): void;
    fechar(): void;
}
const AVISO_DO_CHROME_COMUM = 'Esse clique foi no seu Chrome, fora da janela de gravação — use a janela que a gravação abriu.';
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
        foraDaGravacao?: number;
    }>;
}
export interface MundoDaGravacao {
    abrirWeb?(endereco: string | undefined, aoGravar: (acao: AcaoGravada) => void, aoGesto?: (g: GestoNaoGravado) => void): Promise<NavegadorAberto>;
    abrirBarra?(): Promise<BarraNaSessao>;
    gravarJanelas?(aoAtualizar: (montada: {
        acoes: AcaoGravada[];
        momentos: number[];
        naoGravados?: NaoGravados;
        foraDaGravacao?: number;
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
    motivo: 'parar' | 'fechou' | 'limite' | 'barra';
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
    const comWeb = !!pedido.endereco || pedido.web === true;
    if (comWeb && !mundo.abrirWeb)
        throw new Error('este agente não grava no navegador');
    try {
        if ((await mundo.parcial([], avisos)).parar) {
            return { acoes: [], avisos, motivo: 'parar', naoGravados: {}, entregue: await entregar(mundo, [], avisos, intervalo, {}) };
        }
    }
    catch {
    }
    let barra: BarraNaSessao | undefined;
    let parouNaBarra = false;
    if (mundo.abrirBarra) {
        try {
            barra = await mundo.abrirBarra();
            void barra.parada.then(() => (parouNaBarra = true));
        }
        catch {
            avisos.push('A barra da gravação não abriu neste computador: para parar, use o botão "parar" no Studio.');
        }
    }
    let foraAoVivo = 0;
    try {
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
                foraAoVivo = m.foraDaGravacao ?? 0;
            })
            : undefined;
        let navegador: NavegadorAberto | undefined;
        try {
            if (comWeb) {
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
            const ateAqui = juntarDigitacao(juntarAcoes(web, aoVivo));
            const ultima = ateAqui.at(-1);
            barra?.atualizar({
                acoes: ateAqui.length,
                ...(ultima ? { ultima: descreverAcao(ultima) } : {}),
                ...(foraAoVivo > 0 ? { aviso: AVISO_DO_CHROME_COMUM } : {}),
            });
            if (parouNaBarra) {
                motivo = 'barra';
                break;
            }
            let parar = false;
            try {
                parar = (await mundo.parcial(ateAqui, avisos, false, somarNaoGravados(gestosDaWeb, gestosDasJanelas))).parar;
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
        barra?.fechar();
        const [, doWindows] = await Promise.all([
            navegador?.parar().catch(() => undefined),
            janelas?.parar(),
        ]);
        if (doWindows?.foraDaGravacao) {
            avisos.push(`${doWindows.foraDaGravacao} clique(s) no navegador comum (fora da janela de gravação) não entraram. ` +
                'Para gravar um site, use a janela que a gravação abre.');
        }
        const janela = doWindows ? carimbar(doWindows) : [];
        if (doWindows && doWindows.semAlvo > 0) {
            avisos.push(`${doWindows.semAlvo} gesto(s) no Windows ficaram de fora: o elemento não tinha identificador nem nome, e coordenada não é alvo.`);
        }
        const acoes = caber(juntarDigitacao(juntarAcoes(web, janela)), avisos);
        const naoGravados = somarNaoGravados(gestosDaWeb, doWindows?.naoGravados ?? {});
        return { acoes, avisos, motivo, naoGravados, entregue: await entregar(mundo, acoes, avisos, intervalo, naoGravados) };
    }
    finally {
        barra?.fechar();
    }
}
