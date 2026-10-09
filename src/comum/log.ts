export type Nivel = 'info' | 'aviso' | 'erro';
const NOMES_SECRETOS = 'senha|password|pwd|secret|token|credential|apikey|api_key';
const CAMPOS_SECRETOS = new RegExp(NOMES_SECRETOS, 'i');
const NA_MENSAGEM = new RegExp(`(${NOMES_SECRETOS})(\\s*[=:]\\s*)([^;\\s,"']+)`, 'gi');
const OCULTO = '[oculto]';
function limpar(valor: unknown, noCaminho: WeakSet<object>): unknown {
    if (typeof valor === 'string')
        return valor.replace(NA_MENSAGEM, `$1$2${OCULTO}`);
    if (valor === null || typeof valor !== 'object')
        return valor;
    const obj = valor as object;
    if (noCaminho.has(obj))
        return '[ciclo]';
    if (obj instanceof Error) {
        const erro = obj.message.replace(NA_MENSAGEM, `$1$2${OCULTO}`);
        if (obj.cause === undefined)
            return { erro };
        noCaminho.add(obj);
        try {
            return { erro, causa: limpar(obj.cause, noCaminho) };
        }
        finally {
            noCaminho.delete(obj);
        }
    }
    return limparRamo(obj, noCaminho, obj);
}
function limparRamo(valor: unknown, noCaminho: WeakSet<object>, marcar: object): unknown {
    noCaminho.add(marcar);
    try {
        if (Array.isArray(valor))
            return valor.map((v) => limpar(v, noCaminho));
        if (valor === null || typeof valor !== 'object')
            return limpar(valor, noCaminho);
        const limpo: Record<string, unknown> = {};
        for (const [chave, v] of Object.entries(valor)) {
            limpo[chave] = CAMPOS_SECRETOS.test(chave) ? OCULTO : limpar(v, noCaminho);
        }
        return limpo;
    }
    finally {
        noCaminho.delete(marcar);
    }
}
function ocultarSegredos(dados: Record<string, unknown>): Record<string, unknown> {
    return limparRamo(dados, new WeakSet(), dados) as Record<string, unknown>;
}
export function formatar(nivel: Nivel, mensagem: string, dados: Record<string, unknown> = {}): string {
    return JSON.stringify({
        hora: new Date().toISOString(),
        nivel,
        mensagem: mensagem.replace(NA_MENSAGEM, `$1$2${OCULTO}`),
        ...ocultarSegredos(dados),
    });
}
export function registrar(nivel: Nivel, mensagem: string, dados: Record<string, unknown> = {}): void {
    const linha = formatar(nivel, mensagem, dados);
    if (nivel === 'erro')
        console.error(linha);
    else
        console.log(linha);
}
