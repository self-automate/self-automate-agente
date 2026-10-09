import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { conectarAnunciado, parearPeloConvite, parearPorCodigo, type RodarAdb, } from './pareamento-de-celular.js';
export async function parearPeloAgente(argumento: string, segredo: string, rodar: RodarAdb, espera: {
    prazoMs?: number;
    intervaloMs?: number;
} = {}): Promise<string> {
    const [caminho, alvo = '', ...sobra] = argumento.trim().split(/\s+/);
    if (sobra.length > 0 || !alvo || (caminho !== 'qr' && caminho !== 'codigo')) {
        throw new Error('pedido de celular não reconhecido: o argumento é "qr <serviço>" ou "codigo <IP:porta>".');
    }
    const pareado = caminho === 'qr'
        ? await parearPeloConvite({ servico: alvo, senha: segredo, textoDoQr: '' }, { rodar, ...espera })
        : await parearPorCodigo(alvo, segredo, { rodar });
    const endereco = await conectarAnunciado(pareado.guid, { rodar, ...espera });
    return `Celular conectado em ${endereco}.`;
}
export function rodarAdbPeloCaminho(caminho: string): RodarAdb {
    return (args) => new Promise((ok, falha) => {
        execFile(caminho, args, { timeout: 60000, windowsHide: true }, (erro, stdout, stderr) => {
            if (erro && (erro as NodeJS.ErrnoException).code === 'ENOENT') {
                falha(new Error(`Este computador não tem o adb (Android Platform-Tools) em "${caminho}". ` +
                    'Instale e informe o caminho no campo "adb" da configuração do agente.'));
                return;
            }
            ok(`${String(stdout)}${String(stderr)}`);
        });
    });
}
export function lerCaminhoDoAdb(arquivoDeConfig: string): string {
    try {
        const d = JSON.parse(readFileSync(arquivoDeConfig, 'utf8')) as {
            adb?: unknown;
        };
        return typeof d.adb === 'string' && d.adb.trim() ? d.adb.trim() : 'adb';
    }
    catch {
        return 'adb';
    }
}
