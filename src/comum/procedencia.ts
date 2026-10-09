import { createHash, sign, verify } from 'node:crypto';
export const FORMATO_V2 = 'self-automate:assinatura:v2';
export interface ChavesDePublicacao {
    v1: string;
    v2: string;
}
const ARTEFATO_VALIDO = /^[A-Za-z0-9._-]+$/;
export function declaracaoDaPublicacao(conteudo: Buffer, artefato: string): string {
    if (!ARTEFATO_VALIDO.test(artefato))
        throw new Error(`artefato inválido para a prova v2: ${JSON.stringify(artefato)}`);
    const sha = createHash('sha512').update(conteudo).digest('hex');
    return `${FORMATO_V2}\nartefato:${artefato}\nbytes:${conteudo.length}\nsha512:${sha}\n`;
}
export function montarProvaV2(declaracao: string, assinatura: Buffer): Buffer {
    return Buffer.from(`${declaracao}assinatura:${assinatura.toString('base64')}\n`, 'utf8');
}
export function assinarPublicacaoV2(conteudo: Buffer, artefato: string, chavePrivadaPem: string): Buffer {
    const declaracao = declaracaoDaPublicacao(conteudo, artefato);
    return montarProvaV2(declaracao, assinarPublicacao(Buffer.from(declaracao, 'utf8'), chavePrivadaPem));
}
function lerProvaV2(prova: Buffer): {
    declaracao: string;
    artefato: string;
    bytes: number;
    sha512: string;
    assinatura: Buffer;
} | undefined {
    const texto = prova.toString('utf8');
    const m = /^self-automate:assinatura:v2\nartefato:([A-Za-z0-9._-]+)\nbytes:(0|[1-9][0-9]{0,15})\nsha512:([0-9a-f]{128})\nassinatura:([A-Za-z0-9+/]{86}==)\n$/.exec(texto);
    if (!m)
        return undefined;
    const assinatura = Buffer.from(m[4]!, 'base64');
    if (assinatura.length !== 64)
        return undefined;
    return {
        declaracao: `${FORMATO_V2}\nartefato:${m[1]}\nbytes:${m[2]}\nsha512:${m[3]}\n`,
        artefato: m[1]!,
        bytes: Number(m[2]),
        sha512: m[3]!,
        assinatura,
    };
}
function confereEd25519(mensagem: Buffer, assinatura: Buffer, chavePublicaPem: string): boolean {
    if (!chavePublicaPem)
        return false;
    try {
        return verify(null, mensagem, chavePublicaPem, assinatura);
    }
    catch {
        return false;
    }
}
export function assinarPublicacao(conteudo: Buffer, chavePrivadaPem: string): Buffer {
    if (!chavePrivadaPem?.trim()) {
        throw new Error('não há chave privada de publicação. Sem ela o binário sai sem prova, ' +
            'e agente sem prova RECUSA a atualização — o empacotamento falha aqui de propósito, ' +
            'em vez de produzir um .exe que ninguém consegue instalar.');
    }
    try {
        return sign(null, conteudo, chavePrivadaPem);
    }
    catch (erro) {
        throw new Error('a chave privada de publicação não serviu para assinar: ela precisa ser Ed25519 em PKCS#8 ' +
            `(-----BEGIN PRIVATE KEY-----). Motivo do node: ${erro instanceof Error ? erro.name : 'desconhecido'}.`);
    }
}
export function provaConfere(conteudo: Buffer, assinatura: Buffer | undefined, chaves: string | ChavesDePublicacao, artefato?: string): boolean {
    if (!assinatura || assinatura.length === 0)
        return false;
    const { v1, v2 } = typeof chaves === 'string' ? { v1: chaves, v2: '' } : chaves;
    if (assinatura.length === 64) {
        return confereEd25519(conteudo, assinatura, v1);
    }
    const v2Lida = lerProvaV2(assinatura);
    if (!v2Lida || !v2 || !artefato || v2Lida.artefato !== artefato)
        return false;
    if (v2Lida.bytes !== conteudo.length)
        return false;
    if (createHash('sha512').update(conteudo).digest('hex') !== v2Lida.sha512)
        return false;
    return confereEd25519(Buffer.from(v2Lida.declaracao, 'utf8'), v2Lida.assinatura, v2);
}
export function queixaDeProcedencia(bytes: number, temAssinatura: boolean): string {
    return (`a procedência do binário não foi provada: ${temAssinatura
        ? 'a assinatura não confere com a chave pública que este agente carrega'
        : 'o painel não entregou assinatura nenhuma'} (${bytes} bytes baixados). ` +
        'NADA foi trocado — o agente segue na versão que funciona. ' +
        'Se a atualização é legítima, o binário precisa ser assinado com a chave de publicação ' +
        'e o arquivo de assinatura publicado ao lado do executável.');
}
