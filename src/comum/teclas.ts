export type Passo = string | {
    texto: string;
};
export const TECLAS = [
    'ENTER', 'TAB', 'ESC', 'DELETE', 'BACKSPACE', 'SPACE', 'INSERT',
    'HOME', 'END', 'PAGEUP', 'PAGEDOWN',
    'UP', 'DOWN', 'LEFT', 'RIGHT',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
] as const;
export const MODIFICADORES = ['CTRL', 'ALT', 'SHIFT', 'WIN'] as const;
const CONHECIDAS = new Set<string>(TECLAS);
export function separarModificador(passo: string): {
    mod: string;
    resto: string;
} | undefined {
    const m = /^(CTRL|ALT|SHIFT|WIN)\+(.+)$/.exec(passo);
    return m?.[1] && m[2] ? { mod: m[1], resto: m[2] } : undefined;
}
export function ehTecla(nome: string): boolean {
    return CONHECIDAS.has(nome);
}
export function teclaDesconhecida(nome: string): Error {
    return new Error(`Tecla "${nome}" não está no vocabulário. As conhecidas: ${TECLAS.join(', ')} — ` +
        `com modificador, na forma CTRL+a. Se o parque passou a usar uma tecla nova, ela entra em src/comum/teclas.ts.`);
}
