import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { proteger, revelar } from './segredo-do-agente.js';
import { dirname, join } from 'node:path';
export interface ConfigDoAgente {
    endereco: string;
    token: string;
    concorrencia?: number;
    emailDeTeste?: string;
    adb?: string;
    acessoId?: string;
    acessoSegredo?: string;
}
export function aplicarCaixaDeTeste(c: Pick<ConfigDoAgente, 'emailDeTeste'>, env: NodeJS.ProcessEnv = process.env): void {
    const caixa = c.emailDeTeste?.trim();
    if (!caixa)
        return;
    env.EMAIL_TESTE_PARA = caixa;
    delete env.ENVIO_EXTERNO_AUTORIZADO_POR;
}
const concorrenciaValida = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
export function lerConcorrencia(arquivo: string): number {
    try {
        const d = JSON.parse(readFileSync(arquivo, 'utf8')) as {
            concorrencia?: unknown;
        };
        return concorrenciaValida(d.concorrencia) ? d.concorrencia : 1;
    }
    catch {
        return 1;
    }
}
export function lerConfig(arquivo: string): ConfigDoAgente | undefined {
    try {
        const d = JSON.parse(readFileSync(arquivo, 'utf8')) as Partial<ConfigDoAgente> & {
            tokenProtegido?: string;
            acessoSegredoProtegido?: string;
        };
        const token = d.tokenProtegido ? revelar(d.tokenProtegido) : d.token;
        if (!d.endereco || !token)
            return undefined;
        const acessoSegredo = d.acessoSegredoProtegido
            ? revelar(d.acessoSegredoProtegido)
            : d.acessoSegredo;
        return {
            endereco: d.endereco,
            token,
            ...(d.emailDeTeste ? { emailDeTeste: d.emailDeTeste } : {}),
            ...(concorrenciaValida(d.concorrencia) ? { concorrencia: d.concorrencia as number } : {}),
            ...(d.acessoId ? { acessoId: d.acessoId } : {}),
            ...(acessoSegredo ? { acessoSegredo } : {}),
            ...(typeof d.adb === 'string' && d.adb.trim() ? { adb: d.adb.trim() } : {}),
        };
    }
    catch {
        return undefined;
    }
}
export function gravarConfig(arquivo: string, c: ConfigDoAgente): void {
    mkdirSync(dirname(arquivo), { recursive: true });
    const { token, acessoSegredo, ...resto } = c;
    const noWindows = platform() === 'win32';
    const emDisco = {
        ...resto,
        ...(noWindows
            ? { tokenProtegido: proteger(token), protecao: 'dpapi-usuario' }
            : { token, protecao: 'nenhuma' }),
        ...(acessoSegredo
            ? noWindows
                ? { acessoSegredoProtegido: proteger(acessoSegredo) }
                : { acessoSegredo }
            : {}),
    };
    writeFileSync(arquivo, JSON.stringify(emDisco, null, 2), { encoding: 'utf8', mode: 0o600 });
}
export function configComTokenNovo(atual: ConfigDoAgente | undefined, endereco: string, novo: string): ConfigDoAgente {
    return { ...(atual ?? {}), endereco, token: novo };
}
export function caminhoDaConfig(pasta: string): string {
    return join(pasta, 'bot-agente.config.json');
}
