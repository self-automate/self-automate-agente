interface LeitorDeCofre {
    ler(caminho: string): Promise<Record<string, string>>;
}
export async function lerDoCofre(cofre: LeitorDeCofre, caminho: string, atributo: string): Promise<string> {
    const segredo = await cofre.ler(caminho);
    const iguais = Object.keys(segredo).filter((k) => k.toLowerCase() === atributo.toLowerCase());
    if (iguais.length > 1) {
        throw new Error(`O segredo "${caminho}" tem mais de um campo que se chama "${atributo}" ` +
            `variando só em maiúscula: ${iguais.join(', ')}. ` +
            'Apague o que não vale — escolher por conta própria faria o robô usar um valor que ninguém quis.');
    }
    const valor = iguais.length === 1 ? segredo[iguais[0]!] : undefined;
    if (valor === undefined) {
        const existem = Object.keys(segredo);
        throw new Error(`O segredo "${caminho}" não tem o campo "${atributo}". ` +
            (existem.length ? `Campos cadastrados: ${existem.join(', ')}.` : 'Ele não tem campo nenhum.'));
    }
    if (!valor) {
        throw new Error(`O campo "${atributo}" do segredo "${caminho}" está vazio. Cadastrar o valor rotacionado.`);
    }
    return valor;
}
export function normalizarSegmento(bruto: string): string {
    return bruto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
export function caminhoDeCredencial(locker: string, credencial: string): string {
    const l = normalizarSegmento(locker);
    if (!l) {
        throw new Error(`caminho de credencial sem locker (recebido: ${JSON.stringify(locker)}) — referência vazia não é credencial`);
    }
    const c = normalizarSegmento(credencial);
    if (!c) {
        throw new Error(`caminho de credencial sem nome de credencial (recebido: ${JSON.stringify(credencial)}) — referência vazia não é credencial`);
    }
    return `rpa/${l}/${c}`;
}
