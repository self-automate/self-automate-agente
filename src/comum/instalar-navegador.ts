import { provaConfere, type ChavesDePublicacao } from './procedencia.js';
export const ARQUIVO_DO_NAVEGADOR = 'navegador.zip';
export const PASTA_DO_NAVEGADOR = 'navegador';
export interface MundoDoNavegador {
    pastaDoAgente: string;
    chavePublica: string | ChavesDePublicacao;
    artefato?: string;
    jaInstalado(): boolean;
    baixar(): Promise<Buffer>;
    baixarAssinatura(): Promise<Buffer | undefined>;
    gravar(caminho: string, conteudo: Buffer): Promise<void>;
    extrair(zip: string, destino: string): Promise<void>;
    apagar(caminho: string): Promise<void>;
}
export interface ResultadoDoNavegador {
    instalou: boolean;
    mensagem: string;
}
export interface MundoDoPacote extends MundoDoNavegador {
    arquivo: string;
    pasta?: string;
    conferirProva?: (pacote: Buffer, prova: Buffer, chave: string | ChavesDePublicacao, artefato?: string) => boolean;
}
export async function instalarPacote(mundo: MundoDoPacote): Promise<ResultadoDoNavegador> {
    const baixado = `${mundo.pastaDoAgente}\\${mundo.arquivo}`;
    const destino = mundo.pasta ? `${mundo.pastaDoAgente}\\${mundo.pasta}` : baixado;
    if (mundo.jaInstalado()) {
        return {
            instalou: true,
            mensagem: `\`${mundo.arquivo}\` já está em ${destino}; nada a baixar`,
        };
    }
    const prova = await mundo.baixarAssinatura();
    if (!prova) {
        return {
            instalou: false,
            mensagem: `sem a prova de procedência de \`${mundo.arquivo}\` — o painel não publicou ` +
                `\`${mundo.arquivo}.sig\`. Ausência é recusa: aceitar daria ao ` +
                'atacante o caminho mais barato, que é não publicar a prova.',
        };
    }
    const pacote = await mundo.baixar();
    if (!(mundo.conferirProva ?? provaConfere)(pacote, prova, mundo.chavePublica, mundo.artefato)) {
        return {
            instalou: false,
            mensagem: 'a prova de procedência NÃO confere com a chave pública deste agente. ' +
                'Ou o pacote foi trocado no caminho, ou foi assinado por outra chave. ' +
                'Nada foi gravado.',
        };
    }
    await mundo.gravar(baixado, pacote);
    if (!mundo.pasta) {
        return {
            instalou: true,
            mensagem: `\`${mundo.arquivo}\` instalado em ${baixado}, com procedência conferida.`,
        };
    }
    try {
        await mundo.extrair(baixado, destino);
    }
    catch (erro) {
        return {
            instalou: false,
            mensagem: `o pacote chegou e conferiu, mas a extração falhou: ${erro instanceof Error ? erro.message : String(erro)}. O arquivo ficou em ${baixado}.`,
        };
    }
    await mundo.apagar(baixado);
    return {
        instalou: true,
        mensagem: `\`${mundo.arquivo}\` extraído em ${destino}, com procedência conferida.`,
    };
}
export async function instalarNavegador(mundo: MundoDoNavegador): Promise<ResultadoDoNavegador> {
    const r = await instalarPacote({
        ...mundo,
        arquivo: ARQUIVO_DO_NAVEGADOR,
        pasta: PASTA_DO_NAVEGADOR,
    });
    if (!r.instalou)
        return r;
    return {
        instalou: true,
        mensagem: `${r.mensagem} Aponte \`PLAYWRIGHT_BROWSERS_PATH\` para essa pasta.`,
    };
}
