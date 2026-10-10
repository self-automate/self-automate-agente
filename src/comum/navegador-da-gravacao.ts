import type { Browser, LaunchOptions, Page } from 'playwright';
import type { AcaoGravada, GestoNaoGravado } from './gravacao.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gravarNoNavegador } from './capturador-web.js';
import { powershell } from '../blocos/powershell.js';
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
const TRAZER = `
Add-Type -Name J -Namespace SelfAutomateFrente -MemberDefinition @'
public delegate bool CB(System.IntPtr h, System.IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(CB f, System.IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, System.IntPtr pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern System.IntPtr GetWindow(System.IntPtr h, uint c);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@
$alvo = [uint32]$env:SA_PROCESSO
$script:janela = [IntPtr]::Zero
[void][SelfAutomateFrente.J]::EnumWindows({ param($h, $l)
  $p = 0; [void][SelfAutomateFrente.J]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -eq $alvo -and [SelfAutomateFrente.J]::IsWindowVisible($h) -and [SelfAutomateFrente.J]::GetWindow($h, 4) -eq [IntPtr]::Zero -and [SelfAutomateFrente.J]::GetWindowTextLength($h) -gt 0) { $script:janela = $h; return $false }
  $true }, [IntPtr]::Zero)
if ($script:janela -eq [IntPtr]::Zero) { 'sem janela'; return }
[void][SelfAutomateFrente.J]::ShowWindow($script:janela, 3)
$eu = [SelfAutomateFrente.J]::GetCurrentThreadId()
$ela = [SelfAutomateFrente.J]::GetWindowThreadProcessId([SelfAutomateFrente.J]::GetForegroundWindow(), [IntPtr]::Zero)
$ligou = $ela -ne 0 -and $ela -ne $eu -and [SelfAutomateFrente.J]::AttachThreadInput($eu, $ela, $true)
[void][SelfAutomateFrente.J]::BringWindowToTop($script:janela)
$frente = [SelfAutomateFrente.J]::SetForegroundWindow($script:janela)
if ($ligou) { [void][SelfAutomateFrente.J]::AttachThreadInput($eu, $ela, $false) }
"maximizada; frente=$frente"`;
export async function trazerParaFrente(processo: number | undefined): Promise<string> {
    if (!processo || process.platform !== 'win32')
        return 'sem processo';
    try {
        return (await powershell(TRAZER, { env: { SA_PROCESSO: String(processo) } })).trim();
    }
    catch (erro) {
        return `não trouxe: ${String(erro).slice(0, 200)}`;
    }
}
