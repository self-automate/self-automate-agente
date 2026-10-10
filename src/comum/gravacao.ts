import { ehTecla } from './teclas.js';
export const VERSAO_DA_GRAVACAO = 1;
const TETO_DE_ACOES = 2000;
const TETO_DE_TEXTO = 2000;
export type AlvoNaJanela = {
    id: string;
} | {
    nome: string;
};
export type AcaoGravada = {
    tipo: 'web.abrir';
    url: string;
} | {
    tipo: 'web.clicar';
    seletor: string;
} | {
    tipo: 'web.preencher';
    seletor: string;
    valor: string;
} | {
    tipo: 'web.preencherSegredo';
    seletor: string;
} | {
    tipo: 'web.selecionar';
    seletor: string;
    texto: string;
} | {
    tipo: 'web.marcar';
    seletor: string;
    marcado: boolean;
} | {
    tipo: 'web.teclar';
    tecla: string;
} | {
    tipo: 'web.baixar';
    seletor: string;
    arquivo: string;
    pasta?: string;
    nome?: string;
} | {
    tipo: 'janela.clicar';
    titulo: string;
    alvo: AlvoNaJanela;
} | {
    tipo: 'janela.digitar';
    titulo: string;
    alvo: AlvoNaJanela;
    valor: string;
} | {
    tipo: 'janela.digitarSegredo';
    titulo: string;
    alvo: AlvoNaJanela;
} | {
    tipo: 'janela.teclar';
    titulo: string;
    tecla: string;
};
export interface Gravacao {
    versao: typeof VERSAO_DA_GRAVACAO;
    acoes: AcaoGravada[];
}
const texto = (v: unknown): string | undefined => {
    if (typeof v !== 'string')
        return undefined;
    const t = v.trim();
    return t ? t.slice(0, TETO_DE_TEXTO) : undefined;
};
const valor = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, TETO_DE_TEXTO) : undefined);
const url = (v: unknown): string | undefined => {
    const t = texto(v);
    return t && /^https?:\/\//i.test(t) ? t : undefined;
};
const alvo = (v: unknown): AlvoNaJanela | undefined => {
    if (!v || typeof v !== 'object')
        return undefined;
    const o = v as Record<string, unknown>;
    const id = texto(o.id);
    if (id)
        return { id };
    const nome = texto(o.nome);
    return nome ? { nome } : undefined;
};
const soNome = (v: unknown): string | undefined => {
    const a = texto(v);
    return a && a.length <= 255 && !/[\\/:]/.test(a) && a !== '.' && a !== '..' ? a : undefined;
};
const pastaAbsoluta = (v: unknown): string | undefined => {
    const p = texto(v);
    if (!p || p.length > 260)
        return undefined;
    if (!/^[A-Za-z]:\\/.test(p) && !/^\\\\[^\\]+\\[^\\]+/.test(p))
        return undefined;
    if (/[<>"|?*:]/.test(p.slice(2)))
        return undefined;
    return p.split(/[\\/]/).some((parte) => parte === '..') ? undefined : p;
};
const tecla = (v: unknown): string | undefined => {
    const t = texto(v)?.toUpperCase();
    return t && ehTecla(t) ? t : undefined;
};
function acao(v: unknown): AcaoGravada | undefined {
    if (!v || typeof v !== 'object')
        return undefined;
    const o = v as Record<string, unknown>;
    const seletor = texto(o.seletor);
    const titulo = texto(o.titulo);
    switch (o.tipo) {
        case 'web.abrir': {
            const u = url(o.url);
            return u ? { tipo: 'web.abrir', url: u } : undefined;
        }
        case 'web.clicar':
            return seletor ? { tipo: 'web.clicar', seletor } : undefined;
        case 'web.preencher': {
            const vl = valor(o.valor);
            return seletor && vl !== undefined ? { tipo: 'web.preencher', seletor, valor: vl } : undefined;
        }
        case 'web.preencherSegredo':
            return seletor ? { tipo: 'web.preencherSegredo', seletor } : undefined;
        case 'web.selecionar': {
            const t = texto(o.texto);
            return seletor && t ? { tipo: 'web.selecionar', seletor, texto: t } : undefined;
        }
        case 'web.marcar':
            return seletor && typeof o.marcado === 'boolean' ? { tipo: 'web.marcar', seletor, marcado: o.marcado } : undefined;
        case 'web.teclar': {
            const t = tecla(o.tecla);
            return t ? { tipo: 'web.teclar', tecla: t } : undefined;
        }
        case 'web.baixar': {
            const a = soNome(o.arquivo);
            if (!seletor || !a)
                return undefined;
            const pasta = o.pasta === undefined ? undefined : pastaAbsoluta(o.pasta);
            const nome = o.nome === undefined ? undefined : soNome(o.nome);
            if ((o.pasta !== undefined && !pasta) || (o.nome !== undefined && !nome))
                return undefined;
            return { tipo: 'web.baixar', seletor, arquivo: a, ...(pasta ? { pasta } : {}), ...(nome ? { nome } : {}) };
        }
        case 'janela.clicar': {
            const a = alvo(o.alvo);
            return titulo && a ? { tipo: 'janela.clicar', titulo, alvo: a } : undefined;
        }
        case 'janela.digitar': {
            const a = alvo(o.alvo);
            const vl = valor(o.valor);
            return titulo && a && vl !== undefined ? { tipo: 'janela.digitar', titulo, alvo: a, valor: vl } : undefined;
        }
        case 'janela.digitarSegredo': {
            const a = alvo(o.alvo);
            return titulo && a ? { tipo: 'janela.digitarSegredo', titulo, alvo: a } : undefined;
        }
        case 'janela.teclar': {
            const t = tecla(o.tecla);
            return titulo && t ? { tipo: 'janela.teclar', titulo, tecla: t } : undefined;
        }
        default:
            return undefined;
    }
}
export function lerGravacao(bruto: unknown): {
    gravacao?: Gravacao;
    descartadas: number;
    problema?: string;
} {
    if (!bruto || typeof bruto !== 'object')
        return { descartadas: 0, problema: 'não é uma gravação' };
    const o = bruto as Record<string, unknown>;
    if (o.versao !== VERSAO_DA_GRAVACAO)
        return { descartadas: 0, problema: `versão da gravação desconhecida: ${String(o.versao)}` };
    if (!Array.isArray(o.acoes))
        return { descartadas: 0, problema: 'a gravação não tem a lista de ações' };
    if (o.acoes.length > TETO_DE_ACOES)
        return { descartadas: 0, problema: `ações demais numa gravação (${o.acoes.length}; o teto é ${TETO_DE_ACOES})` };
    const acoes: AcaoGravada[] = [];
    let descartadas = 0;
    for (const v of o.acoes) {
        const a = acao(v);
        if (a)
            acoes.push(a);
        else
            descartadas++;
    }
    return { gravacao: { versao: VERSAO_DA_GRAVACAO, acoes }, descartadas };
}
export const GESTOS_NAO_GRAVADOS = [
    'cliqueDireito',
    'duploClique',
    'arrastar',
    'atalho',
    'teclaDeFuncao',
    'iframe',
    'arquivo',
] as const;
export type GestoNaoGravado = (typeof GESTOS_NAO_GRAVADOS)[number];
export type NaoGravados = Partial<Record<GestoNaoGravado, number>>;
const NOMES_DOS_GESTOS: Record<GestoNaoGravado, string> = {
    cliqueDireito: 'clique com o botão direito',
    duploClique: 'duplo clique',
    arrastar: 'arrastar',
    atalho: 'atalho de teclado (Ctrl ou Alt)',
    teclaDeFuncao: 'tecla de função (F1 a F12)',
    iframe: 'ação dentro de um quadro (iframe)',
    arquivo: 'envio de arquivo',
};
export const nomeDoGesto = (g: GestoNaoGravado): string => NOMES_DOS_GESTOS[g];
export const ehGestoNaoGravado = (g: unknown): g is GestoNaoGravado => typeof g === 'string' && (GESTOS_NAO_GRAVADOS as readonly string[]).includes(g);
const TETO_DO_GESTO = 10000;
export function lerNaoGravados(bruto: unknown): NaoGravados {
    const r: NaoGravados = {};
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto))
        return r;
    for (const [g, n] of Object.entries(bruto as Record<string, unknown>)) {
        if (!ehGestoNaoGravado(g) || typeof n !== 'number' || !Number.isInteger(n) || n <= 0)
            continue;
        r[g] = Math.min(n, TETO_DO_GESTO);
    }
    return r;
}
export function somarNaoGravados(a: NaoGravados, b: NaoGravados): NaoGravados {
    const r: NaoGravados = { ...a };
    for (const g of GESTOS_NAO_GRAVADOS)
        if (b[g])
            r[g] = Math.min((r[g] ?? 0) + b[g]!, TETO_DO_GESTO);
    return r;
}
export function avisoDosNaoGravados(c: NaoGravados): string | undefined {
    const itens = GESTOS_NAO_GRAVADOS.filter((g) => (c[g] ?? 0) > 0).sort((x, y) => c[y]! - c[x]!);
    if (!itens.length)
        return undefined;
    return `Não viraram passo — complete à mão no Studio: ${itens.map((g) => `${c[g]} × ${NOMES_DOS_GESTOS[g]}`).join(', ')}.`;
}
const curto = (t: string, n = 60): string => (t.length > n ? `"${t.slice(0, n)}…"` : `"${t}"`);
const alvoNaTela = (a: AlvoNaJanela): string => ('id' in a ? a.id : `"${a.nome}"`);
const entreAspas = (t: string): string => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
export const seletorPorPapel = (papel: string, nome: string): string => `role=${papel}[name=${entreAspas(nome)}]`;
export const seletorPorId = (id: string): string => `[id=${entreAspas(id)}]`;
export const seletorPorTexto = (texto: string): string => `text=${entreAspas(texto)}`;
const PAPEL_NA_TELA: Record<string, string> = {
    button: 'no botão',
    link: 'no link',
    menuitem: 'no item de menu',
    menuitemcheckbox: 'no item de menu',
    menuitemradio: 'no item de menu',
    tab: 'na aba',
    option: 'na opção',
    checkbox: 'na caixa',
    radio: 'na opção',
    switch: 'no botão',
    combobox: 'na lista',
    textbox: 'no campo',
    searchbox: 'no campo de busca',
    row: 'na linha',
    cell: 'na célula',
    gridcell: 'na célula',
    treeitem: 'no item',
};
function ondeNaTela(seletor: string): string {
    const m = /^role=([a-z]+)\[name="((?:[^"\\]|\\.)*)"\]$/.exec(seletor);
    if (!m)
        return `em ${seletor}`;
    const nome = m[2]!.replace(/\\(.)/g, '$1');
    return `${PAPEL_NA_TELA[m[1]!] ?? `em ${m[1]}`} "${nome}"`;
}
export function descreverAcao(a: AcaoGravada): string {
    switch (a.tipo) {
        case 'web.abrir':
            return `abrir ${a.url}`;
        case 'web.clicar':
            return `clicar ${ondeNaTela(a.seletor)}`;
        case 'web.preencher': {
            const onde = ondeNaTela(a.seletor);
            return `preencher ${onde.startsWith('no campo') ? `o campo${onde.slice('no campo'.length)}` : a.seletor} com ${curto(a.valor)}`;
        }
        case 'web.preencherSegredo':
            return `senha em ${a.seletor} — use uma credencial do cofre`;
        case 'web.selecionar':
            return `escolher ${curto(a.texto)} em ${a.seletor}`;
        case 'web.marcar':
            return `${a.marcado ? 'marcar' : 'desmarcar'} ${a.seletor}`;
        case 'web.teclar':
            return `tecla ${a.tecla}`;
        case 'web.baixar':
            return `baixar ${curto(a.nome ?? a.arquivo)}${a.pasta ? ` em ${a.pasta}` : ''} (clicando ${ondeNaTela(a.seletor)})`;
        case 'janela.clicar':
            return `${a.titulo}: clicar em ${alvoNaTela(a.alvo)}`;
        case 'janela.digitar':
            return `${a.titulo}: digitar ${curto(a.valor)} em ${alvoNaTela(a.alvo)}`;
        case 'janela.digitarSegredo':
            return `${a.titulo}: senha em ${alvoNaTela(a.alvo)} — use uma credencial do cofre`;
        case 'janela.teclar':
            return `${a.titulo}: tecla ${a.tecla}`;
    }
}
export function juntarSeguidas(acoes: AcaoGravada[]): AcaoGravada[] {
    const saida: AcaoGravada[] = [];
    for (const a of acoes) {
        const anterior = saida.at(-1);
        if (a.tipo === 'web.baixar' && anterior?.tipo === 'web.clicar' && anterior.seletor === a.seletor) {
            saida[saida.length - 1] = a;
            continue;
        }
        if (a.tipo === 'web.preencher' && anterior?.tipo === 'web.preencher' && anterior.seletor === a.seletor) {
            saida[saida.length - 1] = a;
            continue;
        }
        if (a.tipo === 'janela.digitar' &&
            anterior?.tipo === 'janela.digitar' &&
            anterior.titulo === a.titulo &&
            JSON.stringify(anterior.alvo) === JSON.stringify(a.alvo)) {
            saida[saida.length - 1] = a;
            continue;
        }
        saida.push(a);
    }
    return saida;
}
