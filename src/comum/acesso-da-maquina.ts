import { readdir, readFile } from 'node:fs/promises';
import { statSync, existsSync } from 'node:fs';
import { MARCAS_DO_NAVEGADOR } from './navegador-do-agente.js';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { LOGS_DE_PROCESSO, varrerLogs } from './log-de-processo.js';
import type { DadosDaMaquina } from './pacote-de-robos.js';
import { PASTAS, RAIZ_DOS_PERFIS, RELATORIOS_DA_CASCA, raizesDoPerfil, SCRIPTS_NO_MAXIMO, SUFIXO_AA, type RaizDeScript, type VarreduraDeScripts, type AcessoDaMaquina, } from './catalogo-de-leitura.js';
export function acessoDaMaquina(pastaDoAgente: string, versao: () => string, dadosDaOrganizacao: () => DadosDaMaquina | undefined = () => undefined): AcessoDaMaquina {
    const relatorios = (): string[] => [...RELATORIOS_DA_CASCA, ...(dadosDaOrganizacao()?.relatoriosLegiveis ?? [])];
    const entregas = () => dadosDaOrganizacao()?.pastasDeEntrega ?? {};
    return {
        relatoriosLegiveis: relatorios,
        pastasDeEntrega: entregas,
        async estadoDoNavegador() {
            const raiz = join(pastaDoAgente, 'navegador');
            const marcasQueFaltam = MARCAS_DO_NAVEGADOR.filter((m) => !existsSync(join(raiz, m)));
            try {
                const deDisco = (globalThis as Record<string, unknown>).__requireDeDisco as ((m: string) => unknown) | undefined;
                if (!deDisco) {
                    return {
                        marcasQueFaltam,
                        carregou: false,
                        motivo: 'este processo nao tem `__requireDeDisco` — ele so existe no .exe empacotado, ' +
                            'entao esta leitura so responde de verdade rodando como agente',
                    };
                }
                const pw = deDisco('playwright-core') as {
                    chromium: unknown;
                };
                if (!pw?.chromium)
                    throw new Error('o playwright-core carregou sem `chromium`');
                return {
                    marcasQueFaltam,
                    carregou: true,
                    caminhoDoExecutavel: `PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(nao setado)'}`,
                };
            }
            catch (erro) {
                return {
                    marcasQueFaltam,
                    carregou: false,
                    motivo: erro instanceof Error ? erro.message : String(erro),
                };
            }
        },
        async estadoDoSsh() {
            const marcas = ['node_modules\\ssh2\\package.json', 'node_modules\\ssh2\\lib\\client.js'];
            const marcasQueFaltam = marcas.filter((m) => !existsSync(join(pastaDoAgente, m)));
            try {
                const deDisco = (globalThis as Record<string, unknown>).__requireDeDisco as ((m: string) => unknown) | undefined;
                if (!deDisco) {
                    return {
                        marcasQueFaltam,
                        carregou: false,
                        motivo: 'este processo nao tem `__requireDeDisco` — ele so existe no .exe empacotado, ' +
                            'entao esta leitura so responde de verdade rodando como agente',
                    };
                }
                const ssh2 = deDisco('ssh2') as {
                    Client?: unknown;
                };
                if (typeof ssh2?.Client !== 'function')
                    throw new Error('a ssh2 carregou sem `Client`');
                const pacote = deDisco('ssh2/package.json') as {
                    version?: string;
                };
                return { marcasQueFaltam, carregou: true, versao: pacote?.version ?? '(sem versao)' };
            }
            catch (erro) {
                return { marcasQueFaltam, carregou: false, motivo: erro instanceof Error ? erro.message : String(erro) };
            }
        },
        async lerRelatorio(nome: string): Promise<string> {
            if (!relatorios().includes(nome)) {
                throw new Error(`"${nome}" não está na lista de relatórios legíveis. ` +
                    `São: ${relatorios().join(', ')}. ` +
                    'A lista é fechada de propósito: caminho livre viraria "leia qualquer ' +
                    'arquivo do servidor de produção", e nesta mesma pasta mora o token do agente.');
            }
            try {
                return await readFile(`${pastaDoAgente}/${nome}`, 'utf8');
            }
            catch {
                return (`"${nome}" ainda não existe em ${pastaDoAgente}.\n\n` +
                    'Isto NÃO é o mesmo que vazio: quer dizer que nada o escreveu até agora.');
            }
        },
        async lerScripts(): Promise<VarreduraDeScripts> {
            const meuPerfil = homedir().replace(/\\/g, '/');
            const perfis = new Map<string, string>([[meuPerfil, meuPerfil.split('/').pop() ?? '']]);
            try {
                for (const item of await readdir(RAIZ_DOS_PERFIS, { withFileTypes: true })) {
                    if (item.isDirectory())
                        perfis.set(RAIZ_DOS_PERFIS + '/' + item.name, item.name);
                }
            }
            catch {
            }
            const org = dadosDaOrganizacao();
            return varrerScripts([
                ...(org?.raizesFixas ?? []),
                ...[...perfis].flatMap(([caminho, conta]) => raizesDoPerfil(caminho, conta, org?.contasNoCodigo ?? [])),
            ]);
        },
        async lerLogsDoProcesso(chave: string) {
            if (!Object.hasOwn(LOGS_DE_PROCESSO, chave)) {
                throw new Error(`chave de processo desconhecida. Use uma destas: ${Object.keys(LOGS_DE_PROCESSO).join(', ')}.`);
            }
            const perfis = new Set<string>([homedir().replace(/\\/g, '/')]);
            try {
                for (const item of await readdir(RAIZ_DOS_PERFIS, { withFileTypes: true })) {
                    if (item.isDirectory())
                        perfis.add(RAIZ_DOS_PERFIS + '/' + item.name);
                }
            }
            catch {
            }
            const bases = [...(dadosDaOrganizacao()?.instalacoesDoAa ?? []), ...[...perfis].map((p) => p + '/' + SUFIXO_AA)];
            return varrerLogs(bases, LOGS_DE_PROCESSO[chave]!.pasta);
        },
        async listarPasta(chave: string): Promise<string[]> {
            if (!Object.hasOwn(PASTAS, chave)) {
                throw new Error(`chave de pasta desconhecida. Use uma destas: ${Object.keys(PASTAS).join(', ')}.`);
            }
            const relativo = PASTAS[chave]!;
            if (isAbsolute(relativo))
                throw new Error('mapa de pastas inválido: caminho absoluto.');
            return await readdir(join(pastaDoAgente, relativo));
        },
        async listarEntrega(chave: string) {
            const pastas = entregas();
            if (!Object.hasOwn(pastas, chave)) {
                return { alcancou: false as const, porque: 'chave de entrega desconhecida' };
            }
            try {
                const tudo = await readdir(pastas[chave]!.caminho, {
                    recursive: true,
                    withFileTypes: true,
                });
                return {
                    alcancou: true as const,
                    itens: tudo.filter((d) => d.isFile()).map((d) => d.name),
                    subpastas: tudo.filter((d) => d.isDirectory()).length,
                };
            }
            catch (erro) {
                return {
                    alcancou: false as const,
                    porque: erro instanceof Error ? erro.message.slice(0, 120) : String(erro),
                };
            }
        },
        letrasDeUnidadeQueRespondem(): string[] {
            const achadas: string[] = [];
            for (let c = 68; c <= 90; c++) {
                const letra = `${String.fromCharCode(c)}:`;
                try {
                    if (statSync(`${letra}\\`).isDirectory())
                        achadas.push(letra);
                }
                catch {
                }
            }
            return achadas;
        },
        lerAmbiente: () => process.env,
        versao,
    };
}
export async function varrerScripts(raizesDeclaradas: readonly RaizDeScript[]): Promise<VarreduraDeScripts> {
    const achados: {
        caminho: string;
        conteudo: string;
    }[] = [];
    const raizes: VarreduraDeScripts["raizes"] = [];
    const varrer = async (dir: string, prefixo: string): Promise<void> => {
        if (achados.length >= SCRIPTS_NO_MAXIMO)
            return;
        const itens = await readdir(dir, { withFileTypes: true });
        for (const item of itens) {
            if (achados.length >= SCRIPTS_NO_MAXIMO)
                return;
            const cheio = join(dir, item.name);
            const rel = prefixo + '/' + item.name;
            if (item.isDirectory()) {
                try {
                    await varrer(cheio, rel);
                }
                catch {
                }
            }
            else if (/\.vbs$/i.test(item.name)) {
                try {
                    achados.push({ caminho: rel, conteudo: await readFile(cheio, 'latin1') });
                }
                catch {
                }
            }
        }
    };
    for (const raiz of raizesDeclaradas) {
        try {
            await varrer(raiz.caminho, raiz.caminho);
            raizes.push({ caminho: raiz.caminho, origem: raiz.origem, alcancou: true });
        }
        catch (erro) {
            raizes.push({
                caminho: raiz.caminho,
                origem: raiz.origem,
                alcancou: false,
                porque: (erro as NodeJS.ErrnoException).code ?? String(erro),
            });
        }
    }
    return { achados, raizes };
}
