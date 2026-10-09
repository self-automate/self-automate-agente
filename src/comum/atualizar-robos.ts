import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { provaConfere, type ChavesDePublicacao } from './procedencia.js';
import { problemaDoPacote, type ManifestoDoPacote } from './pacote-de-robos.js';
import { ARQUIVO_DOS_ROBOS, compilarDoTexto } from './robos-do-disco.js';
export interface MundoDosRobos {
    pasta: string;
    chavePublica: string | ChavesDePublicacao;
    baixarAssinatura: () => Promise<Buffer | undefined>;
    baixarPacote: () => Promise<Buffer>;
}
export type ResultadoDaAtualizacao = {
    trocou: boolean;
    mensagem: string;
    manifesto?: ManifestoDoPacote;
};
const lerOuNada = (caminho: string): Buffer | undefined => {
    try {
        return readFileSync(caminho);
    }
    catch {
        return undefined;
    }
};
export async function atualizarRobosSePreciso(m: MundoDosRobos): Promise<ResultadoDaAtualizacao> {
    const arquivo = join(m.pasta, ARQUIVO_DOS_ROBOS);
    const assinaturaDoArquivo = `${arquivo}.sig`;
    const remota = await m.baixarAssinatura().catch(() => undefined);
    if (!remota || remota.length === 0) {
        return { trocou: false, mensagem: 'o painel não tem pacote de robôs publicado (ou não respondeu) — mantido o que há no disco' };
    }
    const local = lerOuNada(assinaturaDoArquivo);
    if (local && local.equals(remota) && existsSync(arquivo)) {
        return { trocou: false, mensagem: 'pacote de robôs em dia' };
    }
    let conteudo: Buffer;
    try {
        conteudo = await m.baixarPacote();
    }
    catch (erro) {
        return { trocou: false, mensagem: `não consegui baixar o pacote de robôs: ${erro instanceof Error ? erro.message : String(erro)} — mantido o anterior` };
    }
    if (!provaConfere(conteudo, remota, m.chavePublica, ARQUIVO_DOS_ROBOS)) {
        return { trocou: false, mensagem: 'o pacote de robôs baixado não confere com a assinatura — mantido o anterior' };
    }
    let exportado: unknown;
    try {
        exportado = compilarDoTexto(conteudo.toString('utf8'), arquivo);
    }
    catch (erro) {
        return { trocou: false, mensagem: `o pacote de robôs baixado não carrega: ${erro instanceof Error ? erro.message : String(erro)} — mantido o anterior` };
    }
    const problema = problemaDoPacote(exportado);
    if (problema)
        return { trocou: false, mensagem: `o pacote de robôs baixado não fecha com o contrato: ${problema} — mantido o anterior` };
    writeFileSync(`${arquivo}.novo`, conteudo);
    writeFileSync(`${assinaturaDoArquivo}.novo`, remota);
    renameSync(`${arquivo}.novo`, arquivo);
    renameSync(`${assinaturaDoArquivo}.novo`, assinaturaDoArquivo);
    const manifesto = (exportado as {
        manifesto: ManifestoDoPacote;
    }).manifesto;
    return {
        trocou: true,
        mensagem: `pacote de robôs atualizado: ${manifesto.organizacao} ${manifesto.commit}, ${manifesto.robos.length} robôs`,
        manifesto,
    };
}
