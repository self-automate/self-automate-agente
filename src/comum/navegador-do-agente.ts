import { instalarNavegador, PASTA_DO_NAVEGADOR } from './instalar-navegador.js';
import type { MundoDoNavegador, ResultadoDoNavegador } from './instalar-navegador.js';
export const EXECUTAVEL_DO_NAVEGADOR = 'chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
export const MARCAS_DO_NAVEGADOR = [
    'chromium_headless_shell-1234\\INSTALLATION_COMPLETE',
    EXECUTAVEL_DO_NAVEGADOR,
    'node_modules\\playwright-core\\package.json',
];
export function navegadorInstalado(pastaDoAgente: string, existe: (caminho: string) => boolean): boolean {
    const raiz = `${pastaDoAgente.replace(/[\\/]+$/, '')}\\${PASTA_DO_NAVEGADOR}`;
    return MARCAS_DO_NAVEGADOR.every((r) => existe(`${raiz}\\${r}`));
}
export async function buscarNavegadorSePreciso(mundo: MundoDoNavegador): Promise<ResultadoDoNavegador> {
    try {
        return await instalarNavegador(mundo);
    }
    catch (erro) {
        return {
            instalou: false,
            mensagem: 'não consegui instalar o navegador, e o agente segue trabalhando sem ele: ' +
                `${erro instanceof Error ? erro.message : String(erro)}. ` +
                'Robô que precisa de navegador continua fora do registro deste executável, ' +
                'então isto não interrompe nada — mas destrava 8 dos 10 quando funcionar.',
        };
    }
}
