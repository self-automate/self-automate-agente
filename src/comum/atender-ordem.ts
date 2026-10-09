import { registrar } from './log.js';
import { LEITURAS, leituraDoNome, type AcessoDaMaquina } from './catalogo-de-leitura.js';
import type { AcaoGravada, NaoGravados } from './gravacao.js';
export interface CanalDeOrdens {
    retirarOrdem(): Promise<{
        id: string;
        tipo: string;
        argumento: string;
    } | undefined>;
    responderOrdem(id: string, saida: string, codigo: number, duracaoMs: number): Promise<void>;
    segredoDaOrdem?(id: string): Promise<string | undefined>;
    parcialDaGravacao?(id: string, acoes: AcaoGravada[], avisos: string[], fim?: boolean, naoGravados?: NaoGravados): Promise<{
        parar: boolean;
    }>;
}
export interface GravadorDoAgente {
    gravar: (argumento: string, parcial: (acoes: AcaoGravada[], avisos: string[], fim?: boolean, naoGravados?: NaoGravados) => Promise<{
        parar: boolean;
    }>) => Promise<string>;
    aoLancar?: (gravacao: Promise<void>) => void;
}
export interface CelularDoAgente {
    parear: (argumento: string, segredo: string) => Promise<string>;
    aoLancar?: (pareamento: Promise<void>) => void;
}
const NAO_EXECUTOU = 127;
export async function atenderOrdem(canal: CanalDeOrdens, acesso: AcessoDaMaquina, atualizacao?: (versao: string) => Promise<string>, cancelar?: (execucaoId: string) => Promise<string>, celular?: CelularDoAgente, gravador?: GravadorDoAgente): Promise<'vazia' | 'atendida'> {
    let ordem;
    try {
        ordem = await canal.retirarOrdem();
    }
    catch (erro) {
        registrar('erro', 'falha ao pedir ordem', {
            motivo: erro instanceof Error ? erro.message : String(erro),
        });
        return 'vazia';
    }
    if (!ordem)
        return 'vazia';
    if (ordem.tipo === 'celular') {
        await atenderCelular(canal, ordem, celular);
        return 'atendida';
    }
    if (ordem.tipo === 'gravar') {
        await atenderGravacao(canal, ordem, gravador);
        return 'atendida';
    }
    const comeco = Date.now();
    let saida: string;
    let codigo: number;
    try {
        saida = await executar(ordem.tipo, ordem.argumento, acesso, atualizacao, cancelar);
        codigo = 0;
    }
    catch (erro) {
        saida = erro instanceof Error ? erro.message : String(erro);
        codigo = NAO_EXECUTOU;
    }
    try {
        await canal.responderOrdem(ordem.id, saida, codigo, Date.now() - comeco);
    }
    catch (erro) {
        registrar('erro', 'falha ao responder ordem', {
            ordem: ordem.id,
            motivo: erro instanceof Error ? erro.message : String(erro),
        });
    }
    return 'atendida';
}
let pareando = false;
async function atenderCelular(canal: CanalDeOrdens, ordem: {
    id: string;
    argumento: string;
}, celular: CelularDoAgente | undefined): Promise<void> {
    const comeco = Date.now();
    const responder = async (saida: string, codigo: number) => {
        try {
            await canal.responderOrdem(ordem.id, saida, codigo, Date.now() - comeco);
        }
        catch (erro) {
            registrar('erro', 'falha ao responder ordem', {
                ordem: ordem.id,
                motivo: erro instanceof Error ? erro.message : String(erro),
            });
        }
    };
    if (!celular) {
        await responder('este agente não sabe conectar celular — a versão dele é anterior ao pareamento (0155): falta "Enviar a versão".', NAO_EXECUTOU);
        return;
    }
    if (pareando) {
        await responder('já há um celular sendo conectado neste computador: espere terminar e peça de novo.', NAO_EXECUTOU);
        return;
    }
    let segredo: string | undefined;
    try {
        segredo = canal.segredoDaOrdem ? await canal.segredoDaOrdem(ordem.id) : undefined;
    }
    catch {
        segredo = undefined;
    }
    if (!segredo) {
        await responder('o QR ou o código deste pedido expirou ou já foi usado: gere outro na tela do Self Automate.', NAO_EXECUTOU);
        return;
    }
    pareando = true;
    const conhecido = segredo;
    const pareamento = (async () => {
        let saida: string;
        let codigo: number;
        try {
            saida = await celular.parear(ordem.argumento, conhecido);
            codigo = 0;
        }
        catch (erro) {
            saida = erro instanceof Error ? erro.message : String(erro);
            codigo = NAO_EXECUTOU;
        }
        finally {
            pareando = false;
        }
        await responder(saida.replaceAll(conhecido, '******'), codigo);
    })();
    celular.aoLancar?.(pareamento);
}
let gravando = false;
async function atenderGravacao(canal: CanalDeOrdens, ordem: {
    id: string;
    argumento: string;
}, gravador: GravadorDoAgente | undefined): Promise<void> {
    const comeco = Date.now();
    const responder = async (saida: string, codigo: number) => {
        try {
            await canal.responderOrdem(ordem.id, saida, codigo, Date.now() - comeco);
        }
        catch (erro) {
            registrar('erro', 'falha ao responder ordem', {
                ordem: ordem.id,
                motivo: erro instanceof Error ? erro.message : String(erro),
            });
        }
    };
    const parcialDoCanal = canal.parcialDaGravacao?.bind(canal);
    if (!gravador || !parcialDoCanal) {
        await responder('este agente não sabe gravar automação — a versão dele é anterior ao gravador (0163): falta "Enviar a versão".', NAO_EXECUTOU);
        return;
    }
    if (gravando) {
        await responder('já há uma gravação em andamento neste computador: pare a outra e peça de novo.', NAO_EXECUTOU);
        return;
    }
    gravando = true;
    const gravacao = (async () => {
        let saida: string;
        let codigo: number;
        try {
            saida = await gravador.gravar(ordem.argumento, (acoes, avisos, fim, naoGravados) => parcialDoCanal(ordem.id, acoes, avisos, fim, naoGravados));
            codigo = 0;
        }
        catch (erro) {
            saida = erro instanceof Error ? erro.message : String(erro);
            codigo = NAO_EXECUTOU;
        }
        finally {
            gravando = false;
        }
        await responder(saida, codigo);
    })();
    gravador.aoLancar?.(gravacao);
}
async function executar(tipo: string, argumento: string, acesso: AcessoDaMaquina, atualizacao?: (versao: string) => Promise<string>, cancelar?: (execucaoId: string) => Promise<string>): Promise<string> {
    if (tipo === 'cancelar') {
        if (!cancelar) {
            throw new Error('este agente não sabe cancelar — a versão dele é anterior ao processo filho (0135).');
        }
        return await cancelar(argumento);
    }
    if (tipo === 'atualizacao') {
        if (!atualizacao) {
            throw new Error('este agente não sabe se atualizar — a versão dele é anterior ao canal de atualização.');
        }
        return await atualizacao(argumento);
    }
    if (tipo !== 'leitura') {
        throw new Error(`tipo de ordem não reconhecido: "${tipo}". Existem "leitura", "atualizacao", "cancelar", "celular" e "gravar".`);
    }
    const primeiroEspaco = argumento.trim().search(/\s/);
    const nomeDaLeitura = primeiroEspaco === -1 ? argumento.trim() : argumento.trim().slice(0, primeiroEspaco);
    const entrada = primeiroEspaco === -1 ? '' : argumento.trim().slice(primeiroEspaco + 1).trim();
    const leitura = leituraDoNome(nomeDaLeitura);
    if (!leitura) {
        throw new Error(`leitura desconhecida: "${nomeDaLeitura}". Existem: ${LEITURAS.map((l) => l.nome).join(', ')}.`);
    }
    return await leitura.executar(entrada, acesso);
}
