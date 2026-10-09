import type { PacoteAnunciado } from './pacote-de-robos.js';
import type { MontagensAnunciadas } from './montagens-publicadas.js';
export interface RoboRotulado {
    nome: string;
    executor?: string;
    blocosDeWindows?: readonly string[];
}
export const BLOCOS_COM_CANAL_PROVADO: ReadonlySet<string> = new Set(['planilha', 'powershell']);
export const BLOCOS_PROVADOS_COM_AREA_DE_TRABALHO: ReadonlySet<string> = new Set(['tela']);
export interface CapacidadesDoAgente {
    areaDeTrabalho?: boolean;
    telaNaSessao?: boolean;
    contaWindows?: string | undefined;
    pacoteDeRobos?: PacoteAnunciado | undefined;
    montagens?: MontagensAnunciadas | undefined;
}
export const EXECUTOR_PLATAFORMA = 'plataforma';
export const EXECUTOR_AGENTE_WINDOWS = 'agente-windows';
export const EXECUTORES_CONHECIDOS: ReadonlySet<string> = new Set([
    EXECUTOR_PLATAFORMA,
    EXECUTOR_AGENTE_WINDOWS,
]);
export const oAgenteServe = (robo: RoboRotulado, capacidades: CapacidadesDoAgente = {}): boolean => {
    if (robo.executor === EXECUTOR_PLATAFORMA)
        return true;
    if (robo.executor !== EXECUTOR_AGENTE_WINDOWS)
        return false;
    const blocos = robo.blocosDeWindows ?? [];
    if (blocos.length === 0)
        return false;
    return blocos.every((b) => blocoProvado(b, capacidades));
};
export const blocoProvado = (bloco: string, capacidades: CapacidadesDoAgente = {}): boolean => BLOCOS_COM_CANAL_PROVADO.has(bloco) ||
    ((capacidades.areaDeTrabalho === true || capacidades.telaNaSessao === true) &&
        BLOCOS_PROVADOS_COM_AREA_DE_TRABALHO.has(bloco));
