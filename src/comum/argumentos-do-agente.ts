export type Comando = {
    tipo: 'instalar';
    codigo: string;
    portaoId?: string;
} | {
    tipo: 'portao';
    id: string;
} | {
    tipo: 'conectar';
} | {
    tipo: 'rodar';
} | {
    tipo: 'status';
} | {
    tipo: 'testar';
} | {
    tipo: 'desinstalar';
} | {
    tipo: 'ajuda';
    erro?: string;
};
export interface Opcoes {
    intervaloMs: number;
    endereco: string;
    enderecoExplicito: boolean;
    arquivoConfig: string;
}
export interface Interpretacao {
    comando: Comando;
    opcoes: Opcoes;
}
export const ENDERECO_PADRAO = 'https://painel.self-automate.com';
export const INTERVALO_PADRAO_MS = 5000;
const COMANDOS: Record<string, Comando['tipo']> = {
    '--instalar': 'instalar',
    '--portao': 'portao',
    '--conectar': 'conectar',
    '--status': 'status',
    '--testar': 'testar',
    '--desinstalar': 'desinstalar',
    '--ajuda': 'ajuda',
};
function semBarraFinal(u: string): string {
    return u.replace(/\/+$/, '');
}
function apontar(a: string, indice: number): string {
    if (!a.startsWith('--'))
        return `argumento na posicao ${indice + 1}`;
    const prefixo = a.split('=')[0]!;
    return prefixo === a ? prefixo : `${prefixo} (valor colado com "=" nao e aceito)`;
}
export function interpretarArgumentos(argv: string[], arquivoConfigPadrao: string): Interpretacao {
    const opcoes: Opcoes = {
        intervaloMs: INTERVALO_PADRAO_MS,
        endereco: ENDERECO_PADRAO,
        enderecoExplicito: false,
        arquivoConfig: arquivoConfigPadrao,
    };
    const ajuda = (erro?: string): Interpretacao => ({
        comando: erro ? { tipo: 'ajuda', erro } : { tipo: 'ajuda' },
        opcoes,
    });
    let comando: Comando | undefined;
    let bandeiraDoComando = '';
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (Object.hasOwn(COMANDOS, a)) {
            const juntaPortao = (comando?.tipo === 'instalar' && a === '--portao') || (comando?.tipo === 'portao' && a === '--instalar');
            if (comando && !juntaPortao)
                return ajuda(`mais de um comando: ${bandeiraDoComando} e ${a}`);
            if (juntaPortao) {
                i++;
                const valor = argv[i] ?? '';
                if (a === '--portao') {
                    if (!valor || valor.startsWith('--'))
                        return ajuda('faltou o Client Id depois de --portao');
                    comando = { tipo: 'instalar', codigo: (comando as {
                            codigo: string;
                        }).codigo, portaoId: valor };
                }
                else {
                    if (!valor || valor.startsWith('--'))
                        return ajuda('faltou o codigo depois de --instalar');
                    comando = { tipo: 'instalar', codigo: valor, portaoId: (comando as {
                            id: string;
                        }).id };
                }
                continue;
            }
            bandeiraDoComando = a;
            if (a === '--instalar') {
                i++;
                const codigo = argv[i] ?? '';
                if (!codigo || codigo.startsWith('--'))
                    return ajuda('faltou o codigo depois de --instalar');
                comando = { tipo: 'instalar', codigo };
            }
            else if (a === '--portao') {
                i++;
                const id = argv[i] ?? '';
                if (!id || id.startsWith('--'))
                    return ajuda('faltou o Client Id depois de --portao');
                comando = { tipo: 'portao', id };
            }
            else {
                comando = { tipo: COMANDOS[a] } as Comando;
            }
            continue;
        }
        if (a === '--intervalo') {
            i++;
            const bruto = argv[i] ?? '';
            const segundos = Number(bruto);
            if (!Number.isFinite(segundos) || segundos <= 0) {
                return ajuda('intervalo invalido depois de --intervalo: use segundos, numero maior que zero');
            }
            opcoes.intervaloMs = Math.round(segundos * 1000);
            continue;
        }
        if (a === '--endereco') {
            i++;
            const bruto = argv[i] ?? '';
            if (!bruto || bruto.startsWith('--'))
                return ajuda('faltou o endereco depois de --endereco');
            opcoes.endereco = semBarraFinal(bruto);
            opcoes.enderecoExplicito = true;
            continue;
        }
        return ajuda(a.startsWith('--')
            ? `bandeira desconhecida: ${apontar(a, i)}`
            : `${apontar(a, i)} nao pertence a nenhuma opcao`);
    }
    return { comando: comando ?? { tipo: 'rodar' }, opcoes };
}
