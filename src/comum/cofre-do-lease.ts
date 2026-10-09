import { ehMetadeDeEnvelope, type Cofre } from './cofre.js';
import type { Mensagem } from './email.js';
const SO_LEITURA = 'O agente nao grava credencial: o cofre de verdade fica no painel, na nuvem.';
const SEM_ENVELOPE = 'envelope de dupla custodia nao e suportado por este transporte: o agente resolve credencial ' +
    'simples pelo painel, e a montagem das duas metades (com a conferencia de geracao que impede ' +
    'senha meio-rotacionada) so existe no cofre de verdade. Rode este robo fora do agente, ou peca ' +
    'o espelhamento do envelope antes de agenda-lo aqui.';
export function cofreDoLease(resolver: (caminho: string) => Promise<Record<string, string>>, acessoDeEmail?: (credencial: string) => Promise<string>, resolverEnvelope?: (caminho: string) => Promise<{
    usuario: string;
    senha: string;
}>, enviarPelaFerramenta?: (m: Mensagem) => Promise<'smtp'>): Cofre {
    async function ler(caminho: string): Promise<Record<string, string>> {
        if (ehMetadeDeEnvelope(caminho)) {
            throw new Error(`Caminho "${caminho}" é metade de envelope: ${SEM_ENVELOPE}`);
        }
        try {
            return await resolver(caminho);
        }
        catch (erro) {
            const motivo = erro instanceof Error ? erro.message : String(erro);
            throw new Error(`Credencial "${caminho}" não pôde ser resolvida pelo painel: ${motivo}`);
        }
    }
    return {
        ler,
        lerEnvelopado: async (caminho) => {
            if (!resolverEnvelope)
                throw new Error(`Envelope "${caminho}": ${SEM_ENVELOPE}`);
            try {
                const envelope = await resolverEnvelope(caminho);
                if (!envelope || typeof envelope.usuario !== 'string' || typeof envelope.senha !== 'string' || !envelope.senha) {
                    throw new Error('o painel respondeu sem usuario/senha');
                }
                return { usuario: envelope.usuario, senha: envelope.senha };
            }
            catch (erro) {
                const motivo = erro instanceof Error ? erro.message : String(erro);
                throw new Error(`Envelope "${caminho}" não pôde ser espelhado pelo painel: ${motivo}`);
            }
        },
        guardar: async () => {
            throw new Error(SO_LEITURA);
        },
        criarSeAusente: async () => {
            throw new Error(SO_LEITURA);
        },
        ...(acessoDeEmail ? { acessoDeEmail } : {}),
        ...(enviarPelaFerramenta ? { enviarPelaFerramenta } : {}),
    };
}
