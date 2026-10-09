import type { Cofre } from './cofre.js';
import type { AcessoACredencial } from './acesso-a-credencial.js';
import { registrar } from './log.js';
export type Anotar = (acesso: AcessoACredencial) => Promise<void>;
export interface QuemLe {
    agente: string;
    job: string;
}
const TETO_DO_MOTIVO = 500;
export function motivoDaTrilha(erro: unknown): string {
    const texto = erro instanceof Error ? erro.message : String(erro);
    const limpo = texto.trim() || 'o cofre recusou sem mensagem';
    return limpo.length > TETO_DO_MOTIVO ? `${limpo.slice(0, TETO_DO_MOTIVO)}…` : limpo;
}
export function cofreAuditado(cofre: Cofre, anotar: Anotar, quem: QuemLe): Cofre {
    const anotarRecusa = async (caminho: string, erro: unknown): Promise<void> => {
        try {
            await anotar({ ...quem, caminho, concedido: false, motivo: motivoDaTrilha(erro) });
        }
        catch (falhaDaTrilha) {
            registrar('erro', 'a trilha de credencial nao registou uma RECUSA', {
                ...quem,
                caminho,
                motivo: (falhaDaTrilha as Error).message,
            });
        }
    };
    const comTrilha = async <T>(caminho: string, ler: () => Promise<T>): Promise<T> => {
        let valor: T;
        try {
            valor = await ler();
        }
        catch (erro) {
            await anotarRecusa(caminho, erro);
            throw erro;
        }
        await anotar({ ...quem, caminho, concedido: true });
        return valor;
    };
    return {
        ...cofre,
        ler: (caminho) => comTrilha(caminho, () => cofre.ler(caminho)),
        lerEnvelopado: (caminho) => comTrilha(caminho, () => cofre.lerEnvelopado(caminho)),
    };
}
