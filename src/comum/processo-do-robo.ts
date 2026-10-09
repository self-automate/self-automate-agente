import { spawn as spawnDeVerdade, execFile } from 'node:child_process';
import { lerCaixaDeValidacao } from './pedidos-de-automacao.js';
export function ambienteDoFilho(base: NodeJS.ProcessEnv, validacao?: {
    pedido: number;
    caixa: string;
    dominios?: readonly string[];
}): {
    env: NodeJS.ProcessEnv;
    validando?: number;
    recusada?: string;
} {
    if (!validacao)
        return { env: base };
    const lida = lerCaixaDeValidacao(validacao.caixa, validacao.dominios ?? []);
    if (!lida.ok || !lida.caixa)
        return { env: base, recusada: lida.ok ? 'caixa vazia' : lida.erro };
    const env: NodeJS.ProcessEnv = { ...base, EMAIL_TESTE_PARA: lida.caixa };
    delete env.ENVIO_EXTERNO_AUTORIZADO_POR;
    return { env, validando: validacao.pedido };
}
export interface FilhoLancado {
    pid: number | undefined;
    terminou: Promise<{
        codigo: number | null;
        sinal: string | null;
        motivo?: string;
    }>;
    matar(): Promise<void>;
}
export interface ProcessoFilho {
    pid?: number | undefined;
    on(evento: 'exit', ouvinte: (codigo: number | null, sinal: string | null) => void): unknown;
    on(evento: 'error', ouvinte: (erro: Error) => void): unknown;
    kill(sinal?: string): boolean;
}
export interface Lancador {
    spawn(exec: string, args: string[], opcoes: {
        stdio: 'inherit';
        windowsHide: boolean;
        env: NodeJS.ProcessEnv;
    }): ProcessoFilho;
    matarArvore(pid: number): Promise<void>;
}
export const ARGUMENTO_DO_FILHO = '--executar-job';
export const lancadorDeVerdade: Lancador = {
    spawn: (exec, args, opcoes) => spawnDeVerdade(exec, args, opcoes) as unknown as ProcessoFilho,
    matarArvore: (pid) => new Promise<void>((resolve, reject) => {
        if (process.platform !== 'win32')
            return reject(new Error('taskkill só existe no Windows'));
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (erro) => (erro ? reject(erro) : resolve()));
    }),
};
export function lancarProcessoDoRobo(p: {
    execPath: string;
    id: string;
    robo: string;
    env?: NodeJS.ProcessEnv;
    lancador?: Lancador;
}): FilhoLancado {
    const lancador = p.lancador ?? lancadorDeVerdade;
    const filho = lancador.spawn(p.execPath, [ARGUMENTO_DO_FILHO, p.id, p.robo], {
        stdio: 'inherit',
        windowsHide: true,
        env: p.env ?? process.env,
    });
    let saiu = false;
    const terminou = new Promise<{
        codigo: number | null;
        sinal: string | null;
    }>((resolve) => {
        filho.on('exit', (codigo, sinal) => {
            saiu = true;
            resolve({ codigo, sinal });
        });
        filho.on('error', (erro) => {
            if (saiu)
                return;
            saiu = true;
            resolve({ codigo: null, sinal: `erro: ${erro.message}` });
        });
    });
    return {
        pid: filho.pid,
        terminou,
        async matar() {
            if (saiu)
                return;
            const pid = filho.pid;
            if (pid !== undefined) {
                try {
                    await lancador.matarArvore(pid);
                }
                catch {
                    filho.kill('SIGKILL');
                }
            }
            else {
                filho.kill('SIGKILL');
            }
            await terminou;
        },
    };
}
