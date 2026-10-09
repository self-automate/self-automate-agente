import { registrar } from './log.js';
export const CABECALHO_DO_SEGREDO = 'X-Segredo-Do-Runner';
export interface ConfiguracaoDoConsole {
    endereco: string;
    segredo: string;
    fetchFn?: typeof fetch;
}
export function acessoDeEmailPeloConsole(cfg: ConfiguracaoDoConsole): ((credencial: string, vaga?: string) => Promise<string>) | undefined {
    const endereco = cfg.endereco?.trim();
    const segredo = cfg.segredo?.trim();
    if (!endereco || !segredo)
        return undefined;
    const buscar = cfg.fetchFn ?? fetch;
    const base = endereco.replace(/\/+$/, '');
    return async (credencial: string, vaga?: string): Promise<string> => {
        const url = new URL(`${base}/runner/token-de-email`);
        url.searchParams.set('credencial', credencial);
        if (vaga)
            url.searchParams.set('vaga', vaga);
        const r = await buscar(url.toString(), {
            headers: { [CABECALHO_DO_SEGREDO]: segredo },
        });
        if (!r.ok) {
            const corpo = await r.text().catch(() => '');
            let recado = corpo;
            let causa: unknown;
            try {
                const json = JSON.parse(corpo) as {
                    erro?: unknown;
                    causa?: unknown;
                };
                recado = String(json.erro ?? corpo);
                causa = json.causa;
            }
            catch {
            }
            const erro = new Error(`O console recusou emitir o access token de e-mail (HTTP ${r.status}): ${recado}`);
            throw typeof causa === 'string' ? Object.assign(erro, { causa }) : erro;
        }
        const corpo = (await r.json()) as {
            accessToken?: string;
        };
        if (!corpo.accessToken) {
            throw new Error('O console respondeu sem `accessToken`. Confira a versao do console — ' +
                'esta rota nasceu em 28/08/2026.');
        }
        registrar('info', 'access token de e-mail obtido do console', { credencial, vaga });
        return corpo.accessToken;
    };
}
