const NL_RESP = '\n';
const PALAVRAS_DE_CREDENCIAL = /(senha|password|passwd|pwd|secret|token|apikey|api_key|credential|credencial|usuario|username|user|login|auth|chave|key|connectionstring)/i;
const CREDENCIAL_ATRIBUIDA = new RegExp(PALAVRAS_DE_CREDENCIAL.source + '\\s*=', 'i');
const CONTINUA_NA_PROXIMA = /\s_\s*$/;
export function taparCredenciais(conteudo: string): {
    texto: string;
    tampadas: number;
    semAtribuicao: number;
} {
    let tampadas = 0;
    let semAtribuicao = 0;
    let continuando = false;
    const texto = conteudo
        .split(/\r?\n/)
        .map((linha) => {
        if (continuando) {
            continuando = CONTINUA_NA_PROXIMA.test(linha);
            tampadas++;
            return linha.replace(/\S.*$/, '<<tampado>>');
        }
        const corte = linha.indexOf('=');
        if (corte < 0) {
            if (PALAVRAS_DE_CREDENCIAL.test(linha) && !linha.trimStart().startsWith("'"))
                semAtribuicao++;
            return linha;
        }
        const esquerdaSuspeita = PALAVRAS_DE_CREDENCIAL.test(linha.slice(0, corte));
        if (!esquerdaSuspeita && !CREDENCIAL_ATRIBUIDA.test(linha))
            return linha;
        tampadas++;
        continuando = CONTINUA_NA_PROXIMA.test(linha);
        return linha.slice(0, corte) + '= <<tampado>>';
    })
        .join(NL_RESP);
    return { texto, tampadas, semAtribuicao };
}
