export interface FonteDeToken {
    token(): Promise<string>;
    invalidar(): void;
}
const FRACAO_DE_RENOVACAO = 0.8;
export function fonteDeTokenAppRole(endereco: string, roleId: string, secretId: string, fetchFn: typeof fetch = fetch, agora: () => number = Date.now): FonteDeToken {
    const base = endereco.replace(/\/+$/, '');
    let vigente: {
        token: string;
        obtidoEm: number;
        ttlMs: number;
    } | undefined;
    async function autenticar(): Promise<string> {
        const resposta = await fetchFn(`${base}/v1/auth/approle/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
        });
        if (resposta.status !== 200) {
            throw new Error(`login approle recusado (HTTP ${resposta.status}) — o par role_id/secret_id do runner ` +
                'não autentica. Regerar com infra/openbao/identidade-do-runner.js e o token raiz.');
        }
        const corpo = (await resposta.json()) as {
            auth: {
                client_token: string;
                lease_duration: number;
            };
        };
        vigente = {
            token: corpo.auth.client_token,
            obtidoEm: agora(),
            ttlMs: corpo.auth.lease_duration * 1000,
        };
        return vigente.token;
    }
    return {
        async token() {
            if (vigente && agora() - vigente.obtidoEm <= vigente.ttlMs * FRACAO_DE_RENOVACAO) {
                return vigente.token;
            }
            return autenticar();
        },
        invalidar() {
            vigente = undefined;
        },
    };
}
export function tokenDoAmbiente(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): string | FonteDeToken {
    const id = configuracaoDoCofre(env);
    return id.modo === 'approle' ? fonteDeTokenAppRole(id.endereco, id.roleId, id.secretId, fetchFn) : id.token;
}
export function configuracaoDoCofre(env: Record<string, string | undefined>): {
    modo: 'approle';
    endereco: string;
    roleId: string;
    secretId: string;
} | {
    modo: 'token';
    endereco: string;
    token: string;
} {
    const endereco = env.OPENBAO_ADDR;
    if (!endereco)
        throw new Error('Variável de ambiente ausente: OPENBAO_ADDR');
    const roleId = env.COFRE_ROLE_ID;
    const secretId = env.COFRE_SECRET_ID;
    if (roleId || secretId) {
        if (!roleId)
            throw new Error('COFRE_SECRET_ID presente sem COFRE_ROLE_ID — meio par é erro de deploy, não modo antigo');
        if (!secretId)
            throw new Error('COFRE_ROLE_ID presente sem COFRE_SECRET_ID — meio par é erro de deploy, não modo antigo');
        return { modo: 'approle', endereco, roleId, secretId };
    }
    const token = env.OPENBAO_TOKEN;
    if (!token) {
        throw new Error('Nem COFRE_ROLE_ID/COFRE_SECRET_ID (AppRole) nem OPENBAO_TOKEN (estático) presentes — o cofre não tem identidade');
    }
    return { modo: 'token', endereco, token };
}
