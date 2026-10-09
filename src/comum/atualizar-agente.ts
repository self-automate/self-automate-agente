const MINIMO_PLAUSIVEL = 40 * 1024 * 1024;
import { provaConfere, queixaDeProcedencia, type ChavesDePublicacao } from './procedencia.js';
export const ARTEFATO_DO_EXECUTAVEL = 'bot-agente.exe';
export function ehExecutavelDeVerdade(conteudo: Buffer): boolean {
    if (conteudo.length < MINIMO_PLAUSIVEL)
        return false;
    return conteudo[0] === 0x4d && conteudo[1] === 0x5a;
}
export function decidirAtualizacao(rodando: string, doPainel: string | undefined): {
    atualizar: boolean;
    motivo: string;
} {
    const nova = (doPainel ?? '').trim();
    if (!nova) {
        return { atualizar: false, motivo: 'o painel não informou qual versão tem — nada a fazer.' };
    }
    if (nova === rodando) {
        return { atualizar: false, motivo: `já está na versão ${rodando} — mesma versão do painel.` };
    }
    return { atualizar: true, motivo: `painel tem ${nova}, aqui roda ${rodando}.` };
}
export function nomeDoArquivoNovo(executavelEmUso: string): string {
    return `${pastaDe(executavelEmUso)}bot-agente-novo.exe`;
}
const pastaDe = (caminho: string): string => {
    const barra = Math.max(caminho.lastIndexOf('\\'), caminho.lastIndexOf('/'));
    return barra >= 0 ? caminho.slice(0, barra + 1) : '';
};
export interface MundoDaAtualizacao {
    executavelEmUso: string;
    versaoEmUso: string;
    chavePublica: string | ChavesDePublicacao;
    baixar(): Promise<Buffer>;
    baixarAssinatura(): Promise<Buffer | undefined>;
    gravar(caminho: string, conteudo: Buffer): Promise<void>;
    renomear(de: string, para: string): Promise<void>;
    promover?(): Promise<{
        reiniciou: boolean;
        motivo: string;
    }>;
}
export const NOMES_DE_BACKUP = ['bot-agente-anterior.exe', 'bot-agente-anterior-2.exe'] as const;
async function moverOVivoParaFora(mundo: MundoDaAtualizacao, pasta: string): Promise<string> {
    const recusas: string[] = [];
    for (const nome of NOMES_DE_BACKUP) {
        const destino = `${pasta}${nome}`;
        try {
            await mundo.renomear(mundo.executavelEmUso, destino);
            return destino;
        }
        catch (erro) {
            recusas.push(`${nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
        }
    }
    throw new Error('não consegui tirar o executável em uso do caminho, então NADA foi trocado — ' +
        'o agente segue na versão que funciona. Os dois nomes foram recusados, e o ' +
        'motivo mais provável é haver outro processo do agente rodando a partir de um ' +
        `deles.\n  ${recusas.join('\n  ')}`);
}
export async function executarAtualizacao(versaoDoPainel: string | undefined, mundo: MundoDaAtualizacao): Promise<{
    trocou: boolean;
    mensagem: string;
}> {
    const decisao = decidirAtualizacao(mundo.versaoEmUso, versaoDoPainel);
    if (!decisao.atualizar)
        return { trocou: false, mensagem: decisao.motivo };
    const conteudo = await mundo.baixar();
    if (!ehExecutavelDeVerdade(conteudo)) {
        throw new Error(`o que o painel devolveu não é um executável válido (${conteudo.length} bytes). ` +
            'Nada foi trocado. Provavelmente veio uma página de erro ou o download foi cortado.');
    }
    const assinatura = await mundo.baixarAssinatura();
    if (!provaConfere(conteudo, assinatura, mundo.chavePublica, ARTEFATO_DO_EXECUTAVEL)) {
        throw new Error(queixaDeProcedencia(conteudo.length, !!assinatura?.length));
    }
    const destino = nomeDoArquivoNovo(mundo.executavelEmUso);
    await mundo.gravar(destino, conteudo);
    const pasta = pastaDe(mundo.executavelEmUso);
    const backupUsado = await moverOVivoParaFora(mundo, pasta);
    await mundo.renomear(nomeDoArquivoNovo(mundo.executavelEmUso), mundo.executavelEmUso);
    const base = `versão ${versaoDoPainel} gravada e no lugar (${decisao.motivo}). ` +
        `A anterior ficou como ${backupUsado.slice(pasta.length)}. `;
    if (!mundo.promover) {
        return {
            trocou: true,
            mensagem: base + 'A troca só vale no próximo REINÍCIO — este processo segue na versão antiga.',
        };
    }
    const promocao = await mundo.promover();
    return {
        trocou: true,
        mensagem: base +
            (promocao.reiniciou
                ? `REINICIANDO: ${promocao.motivo}`
                : `NÃO reiniciei, e o processo segue na versão antiga: ${promocao.motivo}`),
    };
}
