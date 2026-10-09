import type { Banco } from './banco-tipo.js';
export const CHAVE_DOS_DOMINIOS_DE_VALIDACAO = 'organizacao.dominios_de_validacao';
const DOMINIO = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const MAXIMO = 20;
export function lerListaDeDominios(texto: string): {
    ok: true;
    dominios: string[];
} | {
    ok: false;
    erro: string;
} {
    const dominios = [...new Set(texto.toLowerCase().split(/[\s,;]+/).filter(Boolean))];
    const ruim = dominios.find((d) => !DOMINIO.test(d));
    if (ruim !== undefined)
        return { ok: false, erro: `"${ruim.slice(0, 80)}" não é um domínio (exemplo: empresa.com.br). Nada foi gravado.` };
    if (dominios.length > MAXIMO)
        return { ok: false, erro: `No máximo ${MAXIMO} domínios. Nada foi gravado.` };
    return { ok: true, dominios };
}
export async function dominiosDeValidacao(banco: Banco): Promise<string[]> {
    const { rows } = await banco.pool.query('SELECT valor FROM parametros WHERE chave = $1', [CHAVE_DOS_DOMINIOS_DE_VALIDACAO]);
    const lido = rows[0]?.valor ? String(rows[0].valor) : '';
    const l = lerListaDeDominios(lido);
    return l.ok ? l.dominios : [];
}
export async function gravarDominiosDeValidacao(banco: Banco, dominios: readonly string[], por: string): Promise<void> {
    await banco.pool.query('INSERT INTO parametros (chave, valor, alterado_por) VALUES ($1, $2, $3) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, alterado_em = now(), alterado_por = EXCLUDED.alterado_por', [CHAVE_DOS_DOMINIOS_DE_VALIDACAO, dominios.join(','), por]);
}
