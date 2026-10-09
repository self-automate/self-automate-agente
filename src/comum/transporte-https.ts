import type { PedidoDeColeta } from './janelas-de-rm-tipos.js';
import { registrar } from './log.js';
import { armarConexaoPersistente } from './conexao-persistente.js';
import { cofreDoLease } from './cofre-do-lease.js';
import { CREDENCIAL_NAO_CADASTRADA, HTTP_CREDENCIAL_NAO_CADASTRADA, type Cofre, } from './cofre.js';
import type { CanalDeOrdens } from './atender-ordem.js';
import type { Transporte, Pedido, IdExecucao } from './transporte-tipos.js';
import type { Versao } from './versao.js';
import type { CapacidadesDoAgente } from './quem-o-agente-serve.js';
import { contaDoJobValida, contaWindowsDoProcesso as rodouComo } from './contas-de-execucao.js';
import type { Mensagem } from './email.js';
export const PRAZO_DO_PEDIDO_MS = 30000;
export const PRAZO_DO_ENVIO_PELA_FERRAMENTA_MS = 180000;
export function transporteHttps(endereco: string, token: string, fetchFn: typeof fetch = fetch, aoRotacionar?: (novo: string) => void, acesso?: {
    id: string;
    segredo: string;
}): {
    transporte: Transporte;
    canalDeOrdens: CanalDeOrdens;
    cofreDoJob(id: IdExecucao): Cofre;
} {
    void armarConexaoPersistente().then((c) => {
        if (c.motivo !== 'ja estava armada') {
            registrar(c.armada ? 'info' : 'aviso', 'conexao persistente do agente', c);
        }
    });
    const base = endereco.replace(/\/+$/, '');
    let tokenAtual = token;
    const doPortao: Record<string, string> = acesso
        ? { 'CF-Access-Client-Id': acesso.id, 'CF-Access-Client-Secret': acesso.segredo }
        : {};
    const cabecalho = () => ({
        Authorization: `Bearer ${tokenAtual}`,
        'Content-Type': 'application/json',
        ...doPortao,
    });
    function adotar(novo: unknown): void {
        if (typeof novo !== 'string' || novo === '' || novo === tokenAtual)
            return;
        try {
            aoRotacionar?.(novo);
        }
        catch (erro) {
            registrar('erro', 'o token novo chegou e NAO foi guardado — a rotacao parou aqui', {
                motivo: erro instanceof Error ? erro.message : String(erro),
                efeito: 'o agente segue com o token anterior, que ainda vale pela janela de graca',
            });
            return;
        }
        tokenAtual = novo;
    }
    let ultimoId: IdExecucao = '';
    async function chamar(caminho: string, init?: RequestInit) {
        return fetchFn(`${base}${caminho}`, {
            signal: AbortSignal.timeout(PRAZO_DO_PEDIDO_MS),
            ...init,
            headers: cabecalho(),
        });
    }
    function conferir(r: {
        ok: boolean;
        status: number;
    }, oQue: string): boolean {
        if (r.ok)
            return true;
        registrar('erro', `o painel recusou: ${oQue}`, {
            status: r.status,
            ...(r.status === 401
                ? { provavel: 'token do agente invalido ou vencido — parear a maquina de novo' }
                : {}),
        });
        return false;
    }
    async function jsonOuFalha<T>(r: Response, contexto: string): Promise<T> {
        try {
            return (await r.json()) as T;
        }
        catch {
            throw new Error(`resposta de ${contexto} não é JSON válido (HTTP ${r.status}).`);
        }
    }
    async function tolerante<T>(o_que: string, f: () => Promise<T>, padrao: T): Promise<T> {
        try {
            return await f();
        }
        catch (erro) {
            registrar('erro', `falha ao ${o_que}`, {
                motivo: erro instanceof Error ? erro.message : String(erro),
            });
            return padrao;
        }
    }
    const transporte: Transporte = {
        retirarPedido: (robos) => tolerante('retirar pedido', async (): Promise<Pedido | undefined> => {
            if (robos.length === 0)
                return undefined;
            const r = await chamar('/agente/proximo-job');
            if (r.status === 204)
                return undefined;
            if (!r.ok) {
                registrar('erro', 'o painel recusou o pedido de trabalho', {
                    status: r.status,
                    ...(r.status === 401
                        ? { provavel: 'token do agente inválido ou vencido — parear a máquina de novo' }
                        : {}),
                });
                return undefined;
            }
            const d = await jsonOuFalha<{
                id: string;
                robo: string;
                por: string;
                validacao?: unknown;
                conta?: unknown;
            }>(r, 'proximo-job');
            ultimoId = d.id;
            const v = d.validacao as {
                pedido?: unknown;
                caixa?: unknown;
                dominios?: unknown;
            } | undefined;
            const dominios = Array.isArray(v?.dominios) && v.dominios.every((x) => typeof x === 'string') ? (v.dominios as string[]) : undefined;
            const validacao = v && typeof v.pedido === 'number' && typeof v.caixa === 'string'
                ? { pedido: v.pedido, caixa: v.caixa, ...(dominios ? { dominios } : {}) }
                : undefined;
            const conta = contaDoJobValida(d.conta);
            return { robo: d.robo, por: d.por, id: d.id, ...(validacao ? { validacao } : {}), ...(conta ? { conta } : {}) };
        }, undefined),
        abrirExecucao: async () => ultimoId,
        marcarPasso: (id, passo, feito, total) => tolerante('marcar passo', async () => {
            conferir(await chamar(`/job/${encodeURIComponent(id)}/passo`, {
                method: 'POST',
                body: JSON.stringify({ passo, feito, total }),
            }), 'marcar passo');
        }, undefined),
        fecharExecucao: (id, status, _fim, mensagem) => tolerante('fechar execução', async () => {
            conferir(await chamar(`/job/${encodeURIComponent(id)}/resultado`, {
                method: 'POST',
                body: JSON.stringify({ status, mensagem, ...(rodouComo() ? { rodouComo: rodouComo() } : {}) }),
            }), 'fechar a execucao');
        }, undefined),
        baterPonto: (componente, versao: Versao, capacidades?: CapacidadesDoAgente) => tolerante('bater ponto', async () => {
            const r = await chamar('/agente/batimento', {
                method: 'POST',
                body: JSON.stringify({ componente, versao, ...(capacidades ? { capacidades } : {}) }),
            });
            if (!conferir(r, 'bater ponto'))
                return false;
            const corpo = (await r.json().catch(() => ({}))) as {
                tokenNovo?: unknown;
            };
            adotar(corpo.tokenNovo);
            return true;
        }, false),
        reportarAlcance: async (id, destinos) => {
            const r = await chamar(`/job/${encodeURIComponent(id)}/alcance`, {
                method: 'POST',
                body: JSON.stringify({ destinos }),
            });
            if (!r.ok)
                throw new Error(`o painel recusou o relatório de alcance: HTTP ${r.status}`);
            const corpo = await jsonOuFalha<{
                anotadas?: number;
            }>(r, 'alcance');
            return corpo.anotadas ?? 0;
        },
        reportarJanelaDeRm: async (id, janela) => {
            const r = await chamar(`/job/${encodeURIComponent(id)}/janela-de-rm`, {
                method: 'POST',
                body: JSON.stringify(janela),
            });
            if (!r.ok)
                throw new Error(`o painel recusou a janela de RM: HTTP ${r.status}`);
            const corpo = await jsonOuFalha<{
                id?: number;
                nova?: boolean;
            }>(r, 'janela-de-rm');
            return { id: corpo.id ?? 0, nova: corpo.nova === true };
        },
        coletasPendentes: async (id) => {
            const r = await chamar(`/job/${encodeURIComponent(id)}/coletas-pendentes`);
            if (!r.ok)
                throw new Error(`o painel recusou a lista de coletas: HTTP ${r.status}`);
            const corpo = await jsonOuFalha<{
                coletas?: PedidoDeColeta[];
            }>(r, 'coletas-pendentes');
            return Array.isArray(corpo.coletas) ? corpo.coletas : [];
        },
        reportarColeta: async (id, coletaId, resultados) => {
            const r = await chamar(`/job/${encodeURIComponent(id)}/coleta-resultado`, {
                method: 'POST',
                body: JSON.stringify({ coleta: coletaId, resultados }),
            });
            if (!r.ok)
                throw new Error(`o painel recusou o resultado da coleta ${coletaId}: HTTP ${r.status}`);
        },
        anexarAColeta: async (id, coletaId, rm, nome, bytes) => {
            const r = await chamar(`/job/${encodeURIComponent(id)}/anexo-da-coleta`, {
                method: 'POST',
                body: JSON.stringify({ coleta: coletaId, rm, nome, conteudoBase64: Buffer.from(bytes).toString('base64') }),
                signal: AbortSignal.timeout(PRAZO_DO_ENVIO_PELA_FERRAMENTA_MS),
            });
            if (!r.ok)
                throw new Error(`o painel recusou o anexo ${nome} da coleta ${coletaId}: HTTP ${r.status}`);
        },
    };
    const canalDeOrdens: CanalDeOrdens = {
        retirarOrdem: () => tolerante('retirar ordem', async () => {
            const r = await chamar('/agente/ordem');
            if (r.status === 204)
                return undefined;
            if (!conferir(r, 'retirar ordem'))
                return undefined;
            return await jsonOuFalha<{
                id: string;
                tipo: string;
                argumento: string;
            }>(r, 'ordem');
        }, undefined),
        responderOrdem: async (id, saida, codigo, duracaoMs) => {
            conferir(await chamar(`/agente/ordem/${encodeURIComponent(id)}/resposta`, {
                method: 'POST',
                body: JSON.stringify({ saida, codigo, duracaoMs }),
            }), 'responder a ordem');
        },
        segredoDaOrdem: async (id) => {
            const r = await chamar(`/agente/ordem/${encodeURIComponent(id)}/segredo`);
            if (r.status === 404 || !conferir(r, 'buscar o segredo da ordem'))
                return undefined;
            const corpo = await jsonOuFalha<{
                segredo?: unknown;
            }>(r, 'segredo da ordem');
            return typeof corpo.segredo === 'string' && corpo.segredo ? corpo.segredo : undefined;
        },
    };
    return {
        transporte,
        canalDeOrdens,
        cofreDoJob: (id) => cofreDoLease(async (caminho) => {
            const r = await chamar(`/job/${encodeURIComponent(id)}/credencial?caminho=${encodeURIComponent(caminho)}`);
            if (r.status === HTTP_CREDENCIAL_NAO_CADASTRADA) {
                throw new Error(`${CREDENCIAL_NAO_CADASTRADA}. Cadastre-a na tela de Credenciais do painel.`);
            }
            if (!r.ok)
                throw new Error(`painel respondeu ${r.status}`);
            return await jsonOuFalha<Record<string, string>>(r, 'credencial');
        }, async (credencial) => {
            const r = await chamar(`/job/${encodeURIComponent(id)}/token-de-email?credencial=${encodeURIComponent(credencial)}`);
            if (r.status === 424) {
                const { erro, causa } = await jsonOuFalha<{
                    erro?: string;
                    causa?: unknown;
                }>(r, 'token de e-mail');
                const motivo = String(erro ?? '').slice(0, 200);
                const reautorizar = /invalid_grant|expirou|expired|revogad|revoked/i.test(motivo)
                    ? ' A autorização parece ter caído: rode infra/openbao/autorizar-email.js.'
                    : '';
                const falha = new Error(`Não foi possível renovar o token de e-mail: ${motivo}.${reautorizar}`);
                throw typeof causa === 'string' ? Object.assign(falha, { causa }) : falha;
            }
            if (r.status === 404) {
                throw new Error('o painel não reconhece este job: o arrendamento venceu, ou é de outro agente.');
            }
            if (!r.ok)
                throw new Error(`painel respondeu ${r.status}`);
            const { accessToken } = await jsonOuFalha<{
                accessToken?: string;
            }>(r, 'token de e-mail');
            if (!accessToken) {
                throw new Error('o painel respondeu 200 sem `accessToken`.');
            }
            return accessToken;
        }, async (caminho) => {
            const r = await chamar(`/job/${encodeURIComponent(id)}/credencial?caminho=${encodeURIComponent(caminho)}&envelope=1`);
            if (r.status === HTTP_CREDENCIAL_NAO_CADASTRADA) {
                throw new Error(`${CREDENCIAL_NAO_CADASTRADA}. Cadastre as duas metades na tela de Credenciais do painel.`);
            }
            if (r.status === 409) {
                const { erro } = await jsonOuFalha<{
                    erro?: string;
                }>(r, 'envelope');
                throw new Error(String(erro ?? 'envelope recusado pelo painel').slice(0, 300));
            }
            if (!r.ok)
                throw new Error(`painel respondeu ${r.status}`);
            return await jsonOuFalha<{
                usuario: string;
                senha: string;
            }>(r, 'envelope');
        }, async (m: Mensagem) => {
            const anexos = (m.anexos ?? []).map(({ conteudo, ...resto }) => ({
                ...resto,
                conteudoBase64: Buffer.from(conteudo).toString('base64'),
            }));
            const r = await chamar(`/job/${encodeURIComponent(id)}/e-mail-pela-ferramenta`, {
                method: 'POST',
                body: JSON.stringify({ para: m.para, cc: m.cc ?? [], assunto: m.assunto, corpo: m.corpo, html: m.html === true, anexos }),
                signal: AbortSignal.timeout(PRAZO_DO_ENVIO_PELA_FERRAMENTA_MS),
            });
            if (r.status === 501) {
                throw new Error('a caixa da ferramenta não está ligada no painel: o recuo não tem para onde ir (EMAIL_FERRAMENTA_* no console).');
            }
            if (!r.ok) {
                const { erro } = await jsonOuFalha<{
                    erro?: string;
                }>(r, 'envio pela ferramenta').catch(() => ({ erro: undefined }));
                throw new Error(`o painel não enviou pela caixa da ferramenta (HTTP ${r.status})${erro ? `: ${String(erro).slice(0, 300)}` : ''}`);
            }
            return 'smtp' as const;
        }),
    };
}
