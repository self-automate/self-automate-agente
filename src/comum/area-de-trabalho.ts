import { powershell } from '../blocos/powershell.js';
export const SCRIPT_DA_AREA_DE_TRABALHO = [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -TypeDefinition @'`,
    `using System;using System.Runtime.InteropServices;`,
    `public class AreaDeTrabalho {`,
    ` [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f,bool i,uint a);`,
    ` [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);`,
    `}`,
    `'@`,
    `$s = [System.Diagnostics.Process]::GetCurrentProcess().SessionId`,
    `$d = [AreaDeTrabalho]::OpenInputDesktop(0,$false,0x0100)`,
    `$a = $d -ne [IntPtr]::Zero`,
    `if ($a) { [void][AreaDeTrabalho]::CloseDesktop($d) }`,
    `"SESSAO=$s ALCANCA=$a"`,
].join('\n');
export function lerAreaDeTrabalho(saida: string): boolean {
    const m = /SESSAO=(\d+) ALCANCA=(True|False)/.exec(saida);
    if (!m)
        return false;
    return Number(m[1]) !== 0 && m[2] === 'True';
}
export async function medirAreaDeTrabalho(): Promise<boolean> {
    try {
        return lerAreaDeTrabalho(await powershell(SCRIPT_DA_AREA_DE_TRABALHO));
    }
    catch {
        return false;
    }
}
export function lerSessaoZero(saida: string): boolean {
    const m = /SESSAO=(\d+)/.exec(saida);
    return m !== null && Number(m[1]) === 0;
}
export async function medirSessaoZero(): Promise<boolean> {
    if (process.platform !== 'win32')
        return false;
    try {
        return lerSessaoZero(await powershell(SCRIPT_DA_AREA_DE_TRABALHO));
    }
    catch {
        return false;
    }
}
export function comValidade(medir: () => Promise<boolean>, validadeMs: number, agora: () => number = Date.now): () => Promise<boolean> {
    let valor = false;
    let medidaEm: number | undefined;
    return async () => {
        if (medidaEm !== undefined && agora() - medidaEm < validadeMs)
            return valor;
        try {
            valor = await medir();
        }
        catch {
            valor = false;
        }
        medidaEm = agora();
        return valor;
    };
}
