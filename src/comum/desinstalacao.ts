const normalizar = (caminho: string): string => caminho.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
export function planoDeDesinstalacao(e: {
    executavel: string;
    pastaPadrao: string;
}): {
    pasta: string;
    fica?: string;
} {
    const exe = normalizar(e.executavel);
    const pasta = normalizar(e.pastaPadrao);
    const dentro = exe.startsWith(`${pasta}\\`);
    return dentro ? { pasta: e.pastaPadrao } : { pasta: e.pastaPadrao, fica: e.executavel };
}
export function comandoDeApagarAoSair(pid: number, pasta: string): string {
    const literal = pasta.replace(/'/g, "''");
    const script = `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '${literal}' -Recurse -Force`;
    const codificado = Buffer.from(script, 'utf16le').toString('base64');
    return `Start-Process -FilePath powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${codificado}'`;
}
