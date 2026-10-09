import { win32 } from 'node:path';
export function pastaDeInstalacao(localAppData: string): string {
    return win32.join(localAppData, 'SelfAutomate');
}
export const NOME_DO_ATALHO = 'Self Automate - agente.cmd';
export function conteudoDoAtalho(exe: string): string {
    if (exe.includes('"') || /[\r\n]/.test(exe))
        throw new Error('atalho: caminho do agente com caractere que não cabe na linha');
    return `@start "" /min "${exe}"\r\n`;
}
