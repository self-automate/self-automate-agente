import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { dirname, join } from 'node:path';
import { provaConfere, type ChavesDePublicacao } from './procedencia.js';
import { problemaDoPacote, type ConteudoDoPacote, type ManifestoDoPacote } from './pacote-de-robos.js';
import type { Robo } from '../robo.js';
export const ARQUIVO_DOS_ROBOS = 'robos.js';
export type ResultadoDosRobos = {
    ok: true;
    manifesto: ManifestoDoPacote;
    robos: Robo[];
    interpretarMontagem?: ConteudoDoPacote['interpretarMontagem'];
    dadosDaMaquina?: ConteudoDoPacote['dadosDaMaquina'];
} | {
    ok: false;
    motivo: string;
};
interface ModuloCompilavel {
    filename: string;
    paths: string[];
    exports: unknown;
    _compile(codigo: string, arquivo: string): void;
}
interface ConstrutorDeModulo {
    new (id: string): ModuloCompilavel;
    _nodeModulePaths(pasta: string): string[];
}
export function compilarDoTexto(codigo: string, arquivo: string): unknown {
    const M = Module as unknown as ConstrutorDeModulo;
    const m = new M(arquivo);
    m.filename = arquivo;
    m.paths = M._nodeModulePaths(dirname(arquivo));
    m._compile(codigo, arquivo);
    return m.exports;
}
const lerOuNada = (caminho: string): Buffer | undefined => {
    try {
        return readFileSync(caminho);
    }
    catch {
        return undefined;
    }
};
export function carregarRobosDoDisco(p: {
    pasta: string;
    chavePublica: string | ChavesDePublicacao;
    ler?: (caminho: string) => Buffer | undefined;
    compilar?: (codigo: string, arquivo: string) => unknown;
}): ResultadoDosRobos {
    const ler = p.ler ?? lerOuNada;
    const compilar = p.compilar ?? compilarDoTexto;
    const arquivo = join(p.pasta, ARQUIVO_DOS_ROBOS);
    const conteudo = ler(arquivo);
    if (!conteudo || conteudo.length === 0) {
        return { ok: false, motivo: `sem pacote de robôs em ${p.pasta} — o agente não executa robô nenhum até recebê-lo` };
    }
    if (!provaConfere(conteudo, ler(`${arquivo}.sig`), p.chavePublica, ARQUIVO_DOS_ROBOS)) {
        return { ok: false, motivo: 'a assinatura do pacote de robôs não confere com a chave desta casca — pacote recusado' };
    }
    let exportado: unknown;
    try {
        exportado = compilar(conteudo.toString('utf8'), arquivo);
    }
    catch (erro) {
        return { ok: false, motivo: `o pacote de robôs não carregou: ${erro instanceof Error ? erro.message : String(erro)}` };
    }
    const problema = problemaDoPacote(exportado);
    if (problema)
        return { ok: false, motivo: `o pacote de robôs não fecha com o contrato: ${problema}` };
    const pacote = exportado as ConteudoDoPacote;
    return {
        ok: true,
        manifesto: pacote.manifesto,
        robos: [...pacote.robos],
        ...(pacote.interpretarMontagem ? { interpretarMontagem: pacote.interpretarMontagem } : {}),
        ...(pacote.dadosDaMaquina ? { dadosDaMaquina: pacote.dadosDaMaquina } : {}),
    };
}
