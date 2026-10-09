import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const executar = promisify(execFile);
export async function powershell(script: string, opcoes?: {
    env?: Record<string, string>;
}): Promise<string> {
    const { stdout } = await executar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        ...(opcoes?.env ? { env: { ...process.env, ...opcoes.env } } : {}),
    });
    return stdout.trim();
}
export async function powershellJson<T>(script: string): Promise<T> {
    const saida = await powershell(script);
    try {
        return JSON.parse(saida) as T;
    }
    catch {
        throw new Error(`O PowerShell não devolveu JSON. Primeiros 200 caracteres da saída: ${saida.slice(0, 200)}`);
    }
}
export async function powershellSemFalhar(script: string): Promise<void> {
    try {
        await powershell(`try { ${script} } catch { }\nexit 0`);
    }
    catch {
    }
}
export const aspasPS = (s: string) => `'${s.replace(/'/g, "''")}'`;
