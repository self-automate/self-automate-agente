import { instalarPacote, type MundoDoNavegador, type ResultadoDoNavegador, } from './instalar-navegador.js';
import { PACOTES_DE_DISCO, type PacoteDeDisco } from './pacotes-de-disco.js';
export interface ResultadoDaPeca extends ResultadoDoNavegador {
    nome: string;
}
export type MontarMundo = (p: PacoteDeDisco) => MundoDoNavegador;
export async function buscarPacotesSePreciso(montar: MontarMundo, pecas: readonly PacoteDeDisco[] = PACOTES_DE_DISCO): Promise<ResultadoDaPeca[]> {
    const resultados: ResultadoDaPeca[] = [];
    for (const p of pecas) {
        try {
            const r = await instalarPacote({
                ...montar(p),
                arquivo: p.arquivo,
                ...(p.pasta ? { pasta: p.pasta } : {}),
            });
            resultados.push({ nome: p.nome, ...r });
        }
        catch (erro) {
            resultados.push({
                nome: p.nome,
                instalou: false,
                mensagem: `não consegui instalar \`${p.nome}\`, e o agente segue trabalhando sem ela: ` +
                    `${erro instanceof Error ? erro.message : String(erro)}. ` +
                    `Por que esta peça existe: ${p.porque}`,
            });
        }
    }
    return resultados;
}
