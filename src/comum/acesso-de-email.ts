import { registrar } from './log.js';
import { ehSegredoNaoCadastrado } from './cofre.js';
export interface CofreDeEmail {
    ler(caminho: string): Promise<Record<string, string>>;
    guardar(caminho: string, dados: Record<string, string>): Promise<void>;
}
export const VAGA_DO_TOKEN = 'EMAIL_TOKEN';
const LOGIN = 'https://login.microsoftonline.com';
export const caixaDeEnvio = (cred: Record<string, string>): string | undefined => campoDa(cred, 'Remetente', 'CaixaDeEnvio', 'REMETENTE', 'From');
export const escopoDeEmail = (cred: Record<string, string>): string => caixaDeEnvio(cred)
    ? 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Send.Shared offline_access'
    : 'https://graph.microsoft.com/Mail.Send offline_access';
export const ESCOPO_DE_LEITURA = 'https://graph.microsoft.com/Mail.Read offline_access';
export const campoDa = (cred: Record<string, string>, ...nomes: string[]): string | undefined => {
    for (const n of nomes) {
        const v = cred[n];
        if (typeof v === 'string' && v.trim())
            return v;
    }
    return undefined;
};
export function identidadeDoAplicativo(cred: Record<string, string>, caminho: string, daVaga?: Record<string, string>): {
    tenantId: string;
    clientId: string;
} {
    const tenantId = (daVaga && campoDa(daVaga, 'TenantId', 'TENANT_ID', 'tenant_id')) ??
        campoDa(cred, 'TenantId', 'TENANT_ID', 'tenant_id') ??
        process.env.EMAIL_TENANT_ID;
    const clientId = campoDa(cred, 'ClientId', 'CLIENT_ID', 'client_id') ?? process.env.EMAIL_CLIENT_ID;
    const falta = [!tenantId && 'TenantId', !clientId && 'ClientId'].filter(Boolean);
    if (falta.length) {
        throw new Error(`A credencial "${caminho}" não traz ${falta.join(', ')}, e o ambiente também não. ` +
            `Campos encontrados na vaga: ${Object.keys(cred).join(', ') || '(nenhum)'}.`);
    }
    return { tenantId: tenantId!, clientId: clientId! };
}
export function recadoDaVagaDoToken(vaga: string, erro: unknown, guardado: Record<string, string> = {}): string {
    if (erro === undefined) {
        return (`Sem refresh token na vaga "${vaga}": ela existe no cofre e nao traz "RefreshToken". ` +
            `Campos encontrados: ${Object.keys(guardado).join(', ') || '(nenhum)'}. ` +
            'Autorizar de novo pelo console preenche este campo.');
    }
    if (ehSegredoNaoCadastrado(erro)) {
        return (`Sem refresh token na vaga "${vaga}": ela nao existe no cofre — ninguem autorizou ainda. ` +
            'Autorize pelo console, no botao "Autorizar meu e-mail", ou rode ' +
            'infra/openbao/autorizar-email.js para a vaga da plataforma.');
    }
    const texto = erro instanceof Error ? erro.message : String(erro);
    if (/HTTP 401|HTTP 403|permission|recusad/i.test(texto)) {
        return (`Sem refresh token utilizavel para a vaga "${vaga}": o cofre recusou LER — ` +
            'isso e politica do cofre, nao falta de autorizacao. O token pode estar la e este ' +
            'processo nao o alcanca. Autorizar de novo nao muda nada; quem resolve e a Infra, ' +
            'ou o console emitir o acesso.');
    }
    return (`Sem refresh token na vaga "${vaga}": nao consegui le-la no cofre: ${texto}. ` +
        'Se ela nunca foi criada, autorize pelo console ou rode infra/openbao/autorizar-email.js.');
}
export const CAUSA_NAO_AUTORIZADO = 'nao-autorizado';
export const CAUSA_AUTORIZACAO_VENCIDA = 'autorizacao-vencida';
export function ehNaoAutorizado(erro: unknown): boolean {
    return (typeof erro === 'object' &&
        erro !== null &&
        (erro as {
            causa?: unknown;
        }).causa === CAUSA_NAO_AUTORIZADO);
}
export function ehAutorizacaoVencida(erro: unknown): boolean {
    return (typeof erro === 'object' &&
        erro !== null &&
        (erro as {
            causa?: unknown;
        }).causa === CAUSA_AUTORIZACAO_VENCIDA);
}
export async function renovarAcessoDeEmail(cofre: CofreDeEmail, caminhoDaVaga: string, vagaDoToken: string = VAGA_DO_TOKEN, escopo?: string): Promise<string> {
    const cred = await cofre.ler(caminhoDaVaga).catch(() => ({}) as Record<string, string>);
    let guardado: Record<string, string> = {};
    let falhaAoLerAVaga: unknown;
    try {
        guardado = await cofre.ler(vagaDoToken);
    }
    catch (erro) {
        falhaAoLerAVaga = erro;
    }
    const { tenantId, clientId } = identidadeDoAplicativo(cred, caminhoDaVaga, guardado);
    const refresh = guardado.RefreshToken;
    if (!refresh) {
        const recado = new Error(recadoDaVagaDoToken(vagaDoToken, falhaAoLerAVaga, guardado));
        if (ehSegredoNaoCadastrado(falhaAoLerAVaga)) {
            throw Object.assign(recado, { causa: CAUSA_NAO_AUTORIZADO });
        }
        throw recado;
    }
    const r = await fetch(`${LOGIN}/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            grant_type: 'refresh_token',
            refresh_token: refresh,
            scope: escopo ?? escopoDeEmail(cred),
        }),
    });
    const corpo = (await r.json()) as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
        error_description?: string;
    };
    if (!r.ok || !corpo.access_token) {
        const recado = new Error(`Azure recusou renovar o token: ${corpo.error ?? r.status} — ` +
            `${(corpo.error_description ?? '').split('\n')[0]}. ` +
            'Se a autorização foi revogada, rode autorizar-email.js de novo.');
        throw corpo.error === 'invalid_grant'
            ? Object.assign(recado, { causa: CAUSA_AUTORIZACAO_VENCIDA })
            : recado;
    }
    if (corpo.refresh_token && corpo.refresh_token !== refresh) {
        await cofre.guardar(vagaDoToken, { ...guardado, RefreshToken: corpo.refresh_token });
        registrar('info', 'refresh token de e-mail rotacionado e persistido', {
            vaga: vagaDoToken,
            identidade: caminhoDaVaga,
        });
    }
    return corpo.access_token;
}
