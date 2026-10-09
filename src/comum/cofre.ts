import { registrar } from './log.js';
import type { FonteDeToken } from './cofre-approle.js';
import type { Mensagem } from './email.js';
import { PREFIXO_PESSOAL, ehDoEspacoDasPessoas } from './credencial-pessoal.js';
export interface Cofre {
    guardar(caminho: string, dados: Record<string, string>): Promise<void>;
    ler(caminho: string): Promise<Record<string, string>>;
    lerEnvelopado(caminho: string): Promise<{
        usuario: string;
        senha: string;
    }>;
    criarSeAusente(caminho: string, dados: Record<string, string>): Promise<'criado' | 'ja-existia'>;
    acessoDeEmail?(credencial: string, vaga?: string): Promise<string>;
    enviarPelaFerramenta?(m: Mensagem): Promise<'smtp'>;
}
export function marcarNaoCadastrado<E extends Error>(erro: E): E {
    return Object.assign(erro, { credencialNaoCadastrada: true as const });
}
export function ehSegredoNaoCadastrado(erro: unknown): boolean {
    return (typeof erro === 'object' &&
        erro !== null &&
        (erro as {
            credencialNaoCadastrada?: unknown;
        }).credencialNaoCadastrada === true);
}
const PARTES = ['parte-a', 'parte-b'] as const;
export function ehMetadeDeEnvelope(caminho: string): boolean {
    const ultimo = caminho.slice(caminho.lastIndexOf('/') + 1);
    return (PARTES as readonly string[]).includes(ultimo);
}
export const HTTP_CREDENCIAL_NAO_CADASTRADA = 424;
export const CREDENCIAL_NAO_CADASTRADA = 'credencial nao cadastrada no cofre';
export function motivoDaRecusa(status: number, caminho: string, acao: string): string {
    const onde = `${acao} "${caminho}"`;
    if (status === 503) {
        return (`O cofre está SELADO — por isso ${onde} falhou, e não é o caminho nem a rede. ` +
            'Ele sela a si mesmo a cada reinício da máquina, por desenho. ' +
            'Reabrir precisa da chave de custódia: ver docs/ABERTURA-DO-COFRE.md.');
    }
    if (status === 403) {
        return (`O cofre recusou ${onde}: o token não tem permissão, ou VENCEU (HTTP 403). ` +
            'O token do runner é periódico de 72 h e ninguém o renova, então esta é a ' +
            'causa mais provável. Reemitir exige o token RAIZ — ver docs/MANUAL-OPENBAO.md. ' +
            'Não é o caminho da credencial: caminho errado devolve 404.');
    }
    if (status === 401) {
        return (`O cofre não reconheceu o token ao ${onde} (HTTP 401). ` +
            'Diferente do 403: aqui ele não vale mais nada, e não é caso de permissão. ' +
            'Confira se a variável de ambiente do token chegou ao processo.');
    }
    return `Falha ao ${onde} (HTTP ${status}). Confira o estado do serviço.`;
}
export async function montarEnvelope(caminho: string, ler: (caminhoDaMetade: string) => Promise<Record<string, string>>): Promise<{
    usuario: string;
    senha: string;
}> {
    const metades = await Promise.all(PARTES.map(async (nome) => {
        try {
            return await ler(`${caminho}/${nome}`);
        }
        catch (erro) {
            throw new Error(`Envelope "${caminho}" incompleto ou inacessível: falta "${nome}". ` +
                `Confirme com a equipe custodiante correspondente antes de tentar de novo. ` +
                `(causa: ${(erro as Error).message})`);
        }
    }));
    const ordenadas = [...metades].sort((x, y) => Number(x.ordem) - Number(y.ordem));
    const [primeira, segunda] = ordenadas;
    if (!primeira || !segunda) {
        throw new Error(`Envelope "${caminho}" incompleto: vieram ${ordenadas.length} metades de 2.`);
    }
    if (primeira.ordem === segunda.ordem) {
        throw new Error(`Envelope "${caminho}" inconsistente: as duas metades declaram ordem ${primeira.ordem}. ` +
            'Uma das equipes gravou no lugar errado.');
    }
    if (primeira.geracao !== segunda.geracao) {
        throw new Error(`Envelope "${caminho}" em rotação: a parte ${primeira.ordem} está na geração ` +
            `"${primeira.geracao}" e a parte ${segunda.ordem} na "${segunda.geracao}". ` +
            'A senha NÃO foi montada. Aguarde a segunda equipe concluir a rotação.');
    }
    const senha = `${primeira.parte}${segunda.parte}`;
    const esperado = Number(primeira.tamanho) + Number(segunda.tamanho);
    if (senha.length !== esperado) {
        throw new Error(`Envelope "${caminho}" corrompido: senha montada com ${senha.length} caracteres, ` +
            `os custodiantes declararam ${esperado}. Não foi usada.`);
    }
    const usuario = ordenadas.find((m) => m.usuario)?.usuario;
    if (!usuario) {
        throw new Error(`Envelope "${caminho}" sem o campo "usuario" em nenhuma das metades.`);
    }
    registrar('info', 'envelope aberto', { caminho, usuario });
    return { usuario, senha };
}
export function criarCofre(endereco: string, token: string | FonteDeToken, fetchFn: typeof fetch = fetch, acessoDeEmail?: (credencial: string, vaga?: string) => Promise<string>): Cofre {
    const base = endereco.replace(/\/+$/, '');
    const fonte = typeof token === 'string' ? undefined : token;
    const cabecalho = async () => ({
        'X-Vault-Token': typeof token === 'string' ? token : await token.token(),
        'Content-Type': 'application/json',
    });
    async function ler(caminho: string): Promise<Record<string, string>> {
        if (caminho.startsWith(PREFIXO_PESSOAL) || ehDoEspacoDasPessoas(caminho)) {
            throw new Error(`credencial pessoal ("${caminho.startsWith(PREFIXO_PESSOAL) ? caminho : 'pessoas/…'}") só é entregue a robô que roda no agente — marque o pedido para rodar no computador de quem pediu`);
        }
        let resposta = await fetchFn(`${base}/v1/secret/data/${caminho}`, { headers: await cabecalho() });
        if ((resposta.status === 403 || resposta.status === 401) && fonte) {
            fonte.invalidar();
            resposta = await fetchFn(`${base}/v1/secret/data/${caminho}`, { headers: await cabecalho() });
        }
        if (resposta.status === 404) {
            throw marcarNaoCadastrado(new Error(`Segredo "${caminho}" não encontrado no cofre. ` +
                'Confira o caminho, ou se a credencial já foi cadastrada.'));
        }
        if (!resposta.ok) {
            throw new Error(motivoDaRecusa(resposta.status, caminho, "ler"));
        }
        const corpo = (await resposta.json()) as {
            data?: {
                data?: Record<string, string>;
            };
        };
        const segredo = corpo.data?.data;
        if (!segredo) {
            throw marcarNaoCadastrado(new Error(`Segredo "${caminho}" não encontrado no cofre — resposta sem conteúdo.`));
        }
        return segredo;
    }
    return {
        ler,
        async guardar(caminho, dados) {
            const resposta = await fetchFn(`${base}/v1/secret/data/${caminho}`, {
                method: 'POST',
                headers: await cabecalho(),
                body: JSON.stringify({ data: dados }),
            });
            if (!resposta.ok) {
                throw new Error(motivoDaRecusa(resposta.status, caminho, "gravar em"));
            }
            registrar('info', 'segredo gravado no cofre', { caminho });
        },
        async criarSeAusente(caminho, dados) {
            const resposta = await fetchFn(`${base}/v1/secret/data/${caminho}`, {
                method: 'POST',
                headers: await cabecalho(),
                body: JSON.stringify({ data: dados, options: { cas: 0 } }),
            });
            if (resposta.ok) {
                registrar('info', 'vaga de credencial criada no cofre', { caminho, campos: Object.keys(dados) });
                return 'criado';
            }
            if (resposta.status === 400) {
                registrar('info', 'credencial já existia no cofre — não foi tocada', { caminho });
                return 'ja-existia';
            }
            throw new Error(motivoDaRecusa(resposta.status, caminho, "criar a vaga em"));
        },
        async lerEnvelopado(caminho) {
            return montarEnvelope(caminho, ler);
        },
        ...(acessoDeEmail ? { acessoDeEmail } : {}),
    };
}
export const RECUSA_VAGA_AUSENTE = 'vaga nao cadastrada no cofre';
