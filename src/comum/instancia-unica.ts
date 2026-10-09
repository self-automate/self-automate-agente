export interface ProcessoVisto {
    readonly pid: number;
    readonly caminho: string;
}
export interface RitmoDaEspera {
    readonly tentativas: number;
    readonly esperarMs: number;
}
export const RITMO_PADRAO: RitmoDaEspera = { tentativas: 8, esperarMs: 1000 };
export const comandoDeListarProcessos = (): string => 'Get-CimInstance Win32_Process ' +
    "| Where-Object { $_.Name -like 'bot-agente*' } " +
    '| Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress';
const normalizar = (caminho: string): string => caminho.replace(/\//g, '\\').toLowerCase();
const pastaDe = (caminho: string): string => {
    const n = normalizar(caminho);
    const corte = n.lastIndexOf('\\');
    return corte === -1 ? '' : n.slice(0, corte);
};
const nomeDe = (caminho: string): string => {
    const n = normalizar(caminho);
    return n.slice(n.lastIndexOf('\\') + 1);
};
export function lerProcessos(json: string): ProcessoVisto[] {
    const bruto = json.trim();
    if (!bruto)
        return [];
    let dado: unknown;
    try {
        dado = JSON.parse(bruto);
    }
    catch {
        throw new Error(`saída do PowerShell não é JSON: ${bruto.slice(0, 120)}`);
    }
    const itens = Array.isArray(dado) ? dado : [dado];
    return itens.flatMap((item) => {
        if (typeof item !== 'object' || item === null)
            return [];
        const { ProcessId, ExecutablePath } = item as {
            ProcessId?: unknown;
            ExecutablePath?: unknown;
        };
        if (typeof ProcessId !== 'number')
            return [];
        if (typeof ExecutablePath !== 'string' || !ExecutablePath.trim())
            return [];
        return [{ pid: ProcessId, caminho: ExecutablePath }];
    });
}
export function ehOutraInstancia(meuPid: number, meuExecutavel: string, outro: ProcessoVisto): boolean {
    if (outro.pid === meuPid)
        return false;
    if (pastaDe(outro.caminho) !== pastaDe(meuExecutavel))
        return false;
    return /^bot-agente.*\.exe$/.test(nomeDe(outro.caminho));
}
const dormir = (ms: number): Promise<void> => ms <= 0 ? Promise.resolve() : new Promise((pronto) => setTimeout(pronto, ms));
export function pidDeclarado(valor: string | undefined): number | undefined {
    const bruto = (valor ?? '').trim();
    if (!/^[0-9]+$/.test(bruto))
        return undefined;
    const pid = Number(bruto);
    return pid > 0 ? pid : undefined;
}
export async function esperarAntecessorSair(meuPid: number, meuExecutavel: string, listar: () => Promise<ProcessoVisto[]>, ritmo: RitmoDaEspera = RITMO_PADRAO, antecessorDeclarado?: number): Promise<{
    seguir: boolean;
    motivo: string;
}> {
    let ultimosOutros: ProcessoVisto[] = [];
    for (let volta = 1; volta <= ritmo.tentativas; volta++) {
        let vistos: ProcessoVisto[];
        try {
            vistos = await listar();
        }
        catch (erro) {
            const causa = erro instanceof Error ? erro.message : String(erro);
            return {
                seguir: true,
                motivo: `nao foi possivel medir os processos (${causa}) — seguindo, porque ficar sem agente e pior que duplicar.`,
            };
        }
        const outros = vistos.filter((p) => ehOutraInstancia(meuPid, meuExecutavel, p));
        if (outros.length === 0) {
            return {
                seguir: true,
                motivo: volta === 1
                    ? 'nenhum outro agente nesta pasta.'
                    : `o antecessor saiu na volta ${volta} — era a troca, nao duplicata.`,
            };
        }
        ultimosOutros = outros;
        if (volta < ritmo.tentativas)
            await dormir(ritmo.esperarMs);
    }
    if (ultimosOutros.length === 0) {
        return { seguir: true, motivo: "nenhuma conferencia foi feita — seguindo." };
    }
    const naoDeclarados = ultimosOutros.filter((p) => p.pid !== antecessorDeclarado);
    if (naoDeclarados.length === 0) {
        return {
            seguir: true,
            motivo: `o antecessor declarado (pid ${antecessorDeclarado}) seguia de pe depois de ${ritmo.tentativas} ` +
                'conferencias, mas a substituicao foi DECLARADA por quem pediu a troca — seguindo. ' +
                'Descartar atualizacao em silencio e pior que uma sobreposicao curta.',
        };
    }
    const quem = naoDeclarados[0] ?? ultimosOutros[0];
    return {
        seguir: false,
        motivo: `ja ha um agente vivo nesta pasta (pid ${quem ? quem.pid : '(desconhecido)'}) depois de ` +
            `${ritmo.tentativas} conferencias, e ele NAO foi declarado como antecessor. Este processo sai ` +
            'para nao disputar a fila — provavelmente a tarefa ONLOGON subiu um segundo.',
    };
}
