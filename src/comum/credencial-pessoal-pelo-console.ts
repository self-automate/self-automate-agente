import { CABECALHO_DO_SEGREDO } from './acesso-de-email-pelo-console.js';
import { HTTP_CREDENCIAL_NAO_CADASTRADA, marcarNaoCadastrado, type Cofre } from './cofre.js';
import { PREFIXO_PESSOAL } from './credencial-pessoal.js';
export type PedirCredencialPessoal = (job: string, caminho: string) => Promise<Record<string, string>>;
export function credencialPessoalPeloConsole(cfg: {
    endereco?: string | undefined;
    segredo?: string | undefined;
    fetchFn?: typeof fetch;
}): PedirCredencialPessoal | undefined {
    const endereco = cfg.endereco?.trim();
    const segredo = cfg.segredo?.trim();
    if (!endereco || !segredo)
        return undefined;
    const buscar = cfg.fetchFn ?? fetch;
    const base = endereco.replace(/\/+$/, '');
    return async (job, caminho) => {
        const url = new URL(`${base}/runner/credencial-pessoal`);
        url.searchParams.set('job', job);
        url.searchParams.set('caminho', caminho);
        const r = await buscar(url.toString(), { headers: { [CABECALHO_DO_SEGREDO]: segredo } });
        if (r.ok)
            return (await r.json()) as Record<string, string>;
        const corpo = await r.text().catch(() => '');
        let recado = corpo;
        try {
            recado = (JSON.parse(corpo) as {
                erro?: string;
            }).erro ?? corpo;
        }
        catch {
        }
        const erro = new Error(`o painel recusou a credencial pessoal ${caminho} (HTTP ${r.status}): ${recado}`.slice(0, 500));
        throw r.status === HTTP_CREDENCIAL_NAO_CADASTRADA ? marcarNaoCadastrado(erro) : erro;
    };
}
export function cofreComCredencialPessoal(cofre: Cofre, job: string, pedir: PedirCredencialPessoal | undefined): Cofre {
    if (!pedir)
        return cofre;
    return {
        ...cofre,
        ler: (caminho) => (caminho.startsWith(PREFIXO_PESSOAL) ? pedir(job, caminho) : cofre.ler(caminho)),
    };
}
