import type { Browser, LaunchOptions, Page } from 'playwright';
import type { AcaoGravada, GestoNaoGravado } from './gravacao.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gravarNoNavegador } from './capturador-web.js';
export interface NavegadorDaGravacao {
    qual: 'chrome' | 'edge';
    executavel: string;
    aviso?: string;
}
export type EscolhaDoNavegador = NavegadorDaGravacao | {
    falta: string;
};
const RAIZES = ['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'] as const;
const CHROME = 'Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'Microsoft\\Edge\\Application\\msedge.exe';
function achar(ambiente: Readonly<Record<string, string | undefined>>, existe: (caminho: string) => boolean, sufixo: string): string | undefined {
    for (const raiz of RAIZES) {
        const pasta = ambiente[raiz]?.replace(/[\\/]+$/, '');
        if (!pasta)
            continue;
        const caminho = `${pasta}\\${sufixo}`;
        if (existe(caminho))
            return caminho;
    }
    return undefined;
}
export function escolherNavegadorDaGravacao(ambiente: Readonly<Record<string, string | undefined>>, existe: (caminho: string) => boolean): EscolhaDoNavegador {
    const chrome = achar(ambiente, existe, CHROME);
    if (chrome)
        return { qual: 'chrome', executavel: chrome };
    const edge = achar(ambiente, existe, EDGE);
    if (edge) {
        return {
            qual: 'edge',
            executavel: edge,
            aviso: 'O Chrome não está instalado neste computador; a gravação abre no Edge, que funciona igual ' +
                'para o robô. Se o site só funciona no Chrome, instale-o e grave de novo.',
        };
    }
    return {
        falta: 'Não achei o Chrome nem o Edge neste computador, e a gravação precisa de um dos dois. ' +
            'Instale o Google Chrome e tente de novo.',
    };
}
export function opcoesDeLancamento(navegador: NavegadorDaGravacao): LaunchOptions {
    return { headless: false, executablePath: navegador.executavel, chromiumSandbox: true };
}
export interface NavegadorGravando {
    pagina: Page;
    versao: string;
    processo?: number;
    fechado: Promise<void>;
    parar(): Promise<void>;
}
export async function abrirNavegadorDaGravacao(navegador: NavegadorDaGravacao, aoGravar: (acao: AcaoGravada) => void, aoGesto?: (g: GestoNaoGravado) => void): Promise<NavegadorGravando> {
    const browser: Browser = await (await import('playwright')).chromium.launch(opcoesDeLancamento(navegador));
    try {
        const contexto = await browser.newContext({ viewport: null });
        await gravarNoNavegador(contexto, aoGravar, aoGesto, join(homedir(), 'Downloads'));
        const pagina = await contexto.newPage();
        const fechado = new Promise<void>((r) => browser.once('disconnected', () => r()));
        const processo = await browser
            .newBrowserCDPSession()
            .then((cdp) => cdp.send('SystemInfo.getProcessInfo'))
            .then((i) => (i as {
            processInfo: {
                type: string;
                id: number;
            }[];
        }).processInfo.find((p) => p.type === 'browser')?.id)
            .catch(() => undefined);
        return {
            pagina,
            versao: browser.version(),
            ...(processo ? { processo } : {}),
            fechado,
            parar: async () => {
                if (browser.isConnected())
                    await browser.close();
            },
        };
    }
    catch (erro) {
        await browser.close();
        throw erro;
    }
}
