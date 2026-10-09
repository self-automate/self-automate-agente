export const JANELA_DE_CONEXAO_MS = 60000;
const SIMBOLO = Symbol.for('undici.globalDispatcher.1');
export function criarAgentePersistente(global: Record<symbol, unknown>): {
    armada: boolean;
    motivo: string;
} {
    const atual = global[SIMBOLO];
    if (!atual || typeof atual !== 'object') {
        return {
            armada: false,
            motivo: 'dispatcher global ausente — esta versao do Node nao expoe o simbolo; ' +
                'seguindo com o keep-alive padrao (conexao nova a cada batimento)',
        };
    }
    try {
        const Agente = (atual as {
            constructor: new (opcoes: object) => object;
        }).constructor;
        global[SIMBOLO] = new Agente({
            keepAliveTimeout: JANELA_DE_CONEXAO_MS,
            keepAliveMaxTimeout: 10 * JANELA_DE_CONEXAO_MS,
        });
        return {
            armada: true,
            motivo: `keep-alive de ${JANELA_DE_CONEXAO_MS / 1000} s — DNS resolvido so ao (re)conectar`,
        };
    }
    catch (erro) {
        return {
            armada: false,
            motivo: 'falha ao armar: ' + (erro instanceof Error ? erro.message : String(erro)),
        };
    }
}
let jaArmada = false;
export async function armarConexaoPersistente(): Promise<{
    armada: boolean;
    motivo: string;
}> {
    if (jaArmada)
        return { armada: false, motivo: 'ja estava armada' };
    await fetch('data:text/plain,escorva').catch(() => undefined);
    const resultado = criarAgentePersistente(globalThis as unknown as Record<symbol, unknown>);
    if (resultado.armada)
        jaArmada = true;
    return resultado;
}
