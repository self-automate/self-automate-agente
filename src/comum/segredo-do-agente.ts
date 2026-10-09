import { execFileSync } from 'node:child_process';
const PISO_DO_BLOB = 200;
const PS = ['-NoProfile', '-NonInteractive', '-Command'];
export function ehProtegido(valor: string): boolean {
    return valor.length >= PISO_DO_BLOB && /^[0-9a-fA-F]+$/.test(valor);
}
function powershell(script: string, entrada: string): string {
    try {
        return execFileSync('powershell', [...PS, script], {
            input: entrada,
            encoding: 'utf8',
            windowsHide: true,
        }).trim();
    }
    catch (erro) {
        const detalhe = erro instanceof Error ? erro.message : String(erro);
        throw new Error(`o PowerShell nao respondeu: ${detalhe}`);
    }
}
export function proteger(valor: string): string {
    const blob = powershell('$claro = [Console]::In.ReadToEnd();' +
        'ConvertTo-SecureString -String $claro -AsPlainText -Force | ConvertFrom-SecureString', valor);
    if (!ehProtegido(blob)) {
        throw new Error('a protecao do segredo nao produziu um blob DPAPI valido. ' +
            'O token NAO foi gravado — rode `--instalar <codigo>` de novo.');
    }
    return blob;
}
export function revelar(blob: string): string {
    let valor: string;
    try {
        valor = powershell('$blob = [Console]::In.ReadToEnd().Trim();' +
            '$s = ConvertTo-SecureString -String $blob;' +
            "[System.Net.NetworkCredential]::new('', $s).Password", blob);
    }
    catch {
        throw new Error('o segredo do agente nao pode ser lido por esta conta do Windows. ' +
            'Ele foi protegido para OUTRA conta — rode `--instalar <codigo>` com a conta ' +
            'que executa a tarefa agendada.');
    }
    if (valor === '') {
        throw new Error('o segredo do agente veio vazio ao ser revelado. ' +
            'Rode `--instalar <codigo>` para parear de novo.');
    }
    return valor;
}
