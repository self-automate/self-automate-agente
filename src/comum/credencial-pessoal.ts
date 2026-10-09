export const PREFIXO_PESSOAL = 'pessoal/';
export const ESPACO_DAS_PESSOAS = 'pessoas/';
export const NOME_DE_CREDENCIAL_PESSOAL = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LOGIN_LEGIVEL = /^[A-Za-z0-9_-]+$/;
export const caminhoPessoal = (nome: string): string => `${PREFIXO_PESSOAL}${nome}`;
export function nomeDoCaminhoPessoal(caminho: string): string | undefined {
    if (!caminho.startsWith(PREFIXO_PESSOAL))
        return undefined;
    const nome = caminho.slice(PREFIXO_PESSOAL.length);
    return NOME_DE_CREDENCIAL_PESSOAL.test(nome) ? nome : undefined;
}
export const ehDoEspacoDasPessoas = (caminho: string): boolean => caminho === ESPACO_DAS_PESSOAS.slice(0, -1) || caminho.startsWith(ESPACO_DAS_PESSOAS);
export type DecisaoPessoal = {
    ok: true;
    caminho: string;
    dono: string;
    pedidos: number[];
} | {
    ok: false;
    motivo: string;
};
export function decidirCredencialPessoal(nome: string, robo: string, pedidos: readonly {
    id: number;
    criadoPor: string;
}[]): DecisaoPessoal {
    if (!pedidos.length) {
        return { ok: false, motivo: `nenhum pedido do robô "${robo}" declarou a credencial pessoal "${nome}" — a equipe declara na ficha do pedido` };
    }
    const donos = [...new Set(pedidos.map((p) => p.criadoPor.toLowerCase()))];
    if (donos.length > 1) {
        return { ok: false, motivo: `mais de uma pessoa declarou "${nome}" para o robô "${robo}" (pedidos ${pedidos.map((p) => p.id).join(', ')}) — não há como saber de quem é a senha` };
    }
    const login = donos[0]!;
    if (!LOGIN_LEGIVEL.test(login)) {
        return { ok: false, motivo: `o login de quem pediu tem ponto ou outro caractere que o painel não lê — o mesmo limite do e-mail por pessoa` };
    }
    return { ok: true, caminho: `${ESPACO_DAS_PESSOAS}${login}/${nome}`, dono: pedidos[0]!.criadoPor, pedidos: pedidos.map((p) => p.id) };
}
