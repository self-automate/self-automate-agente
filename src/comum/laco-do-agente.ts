export interface OpcoesDoLaco {
    intervaloMs: number;
    umaVolta: () => Promise<void>;
    dormir?: (ms: number) => Promise<void>;
    aoFalhar?: (erro: unknown) => void;
}
export interface LacoEmCurso {
    pedirParada(): void;
    terminou: Promise<void>;
    parar(): Promise<void>;
}
const dormirDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function iniciarLaco(opcoes: OpcoesDoLaco): LacoEmCurso {
    const dormir = opcoes.dormir ?? dormirDeVerdade;
    let parado = false;
    let sinalizar = () => { };
    const sinalDeParada = new Promise<void>((r) => {
        sinalizar = r;
    });
    const terminou = (async () => {
        while (!parado) {
            try {
                await opcoes.umaVolta();
            }
            catch (erro) {
                opcoes.aoFalhar?.(erro);
            }
            if (parado)
                break;
            try {
                await Promise.race([dormir(opcoes.intervaloMs), sinalDeParada]);
            }
            catch (erro) {
                opcoes.aoFalhar?.(erro);
                await Promise.race([dormirDeVerdade(opcoes.intervaloMs), sinalDeParada]);
            }
        }
    })();
    terminou.catch(() => { });
    const pedirParada = () => {
        parado = true;
        sinalizar();
    };
    return {
        pedirParada,
        terminou,
        async parar() {
            pedirParada();
            await terminou;
        },
    };
}
