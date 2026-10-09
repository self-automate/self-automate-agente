import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { taparCredenciais } from './tampa-de-credencial.js';
export interface LogDeProcesso {
    pasta: string;
    descricao: string;
}
export const LOGS_DE_PROCESSO: Record<string, LogDeProcesso> = {
    'cmd-prints-mensais': {
        pasta: 'My Docs/CMD - Prints Mensais/Log',
        descricao: 'ORQUESTRADOR de My Tasks\\CMD - Prints Mensais (prints de Splunk, AppDynamics, Overscore e Grafana)',
    },
};
export const ehNomeDeLog = (nome: string): boolean => /^\d{1,2}[_-]\d{1,2}[_-]\d{4}\.txt$/i.test(nome);
const dataDoNome = (nome: string): number => {
    const m = nome.match(/^(\d{1,2})[_-](\d{1,2})[_-](\d{4})/);
    return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : 0;
};
const MAIOR_LOG_BYTES = 8 * 1024 * 1024;
export interface LogAchado {
    nome: string;
    caminho: string;
    tamanho: number;
    modificado: string;
    conteudo: string;
}
export interface VarreduraDeLogs {
    achados: LogAchado[];
    raizes: {
        caminho: string;
        alcancou: boolean;
        porque?: string;
    }[];
}
export function varrerLogs(raizes: string[], pasta: string): VarreduraDeLogs {
    const achados: LogAchado[] = [];
    const onde: VarreduraDeLogs['raizes'] = [];
    for (const raiz of raizes) {
        const dir = join(raiz, ...pasta.split('/'));
        let nomes: string[];
        try {
            nomes = readdirSync(dir);
        }
        catch (erro) {
            onde.push({ caminho: dir, alcancou: false, porque: (erro as {
                    code?: string;
                }).code ?? 'erro' });
            continue;
        }
        onde.push({ caminho: dir, alcancou: true });
        for (const nome of nomes.filter(ehNomeDeLog)) {
            const caminho = join(dir, nome);
            try {
                const st = statSync(caminho);
                if (!st.isFile() || st.size > MAIOR_LOG_BYTES)
                    continue;
                achados.push({ nome, caminho, tamanho: st.size, modificado: st.mtime.toISOString(), conteudo: readFileSync(caminho, 'latin1') });
            }
            catch {
            }
        }
    }
    return { achados, raizes: onde };
}
export function limparLog(texto: string): {
    texto: string;
    tampadas: number;
} {
    const semConsulta = texto.replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi, '$1?<consulta retirada>');
    const { texto: limpo, tampadas } = taparCredenciais(semConsulta);
    return { texto: limpo.replace(/\r?\n/g, '\n'), tampadas };
}
export const TETO_DA_RESPOSTA = 19000;
const tamanho = (s: string): number => s.length;
const LINHA_FORTE = /falha|erro|error|exce[cç][aã]o|exception|timeout|tempo esgotado|n[aã]o encontr|bloquead/i;
const LINHA_FRACA = /sess[aã]o|linha \d/i;
const DIAS_DE_ATENCAO = 10;
const LINHAS_DO_TRECHO = 120;
function ondeProcurei(raizes: VarreduraDeLogs['raizes']): string[] {
    const alcancadas = raizes.filter((r) => r.alcancou);
    const inexistentes = raizes.filter((r) => !r.alcancou && r.porque === 'ENOENT');
    const outras = raizes.filter((r) => !r.alcancou && r.porque !== 'ENOENT');
    return [
        ...alcancadas.map((r) => `  alcancei      ${r.caminho}`),
        ...outras.map((r) => `  NAO alcancei  ${r.caminho}  (${r.porque ?? 'erro'})`),
        ...(inexistentes.length
            ? [
                `  + ${inexistentes.length} perfil(is)/raiz(es) sem a pasta (ENOENT), por exemplo:`,
                ...inexistentes.slice(0, 2).map((r) => `      ${r.caminho}`),
            ]
            : []),
    ];
}
export function montarRelatorioDeLog(chave: string, v: VarreduraDeLogs, teto: number = TETO_DA_RESPOSTA): string {
    const alvo = LOGS_DE_PROCESSO[chave];
    const cab: string[] = [
        `LOG DO PROCESSO ${chave}`,
        alvo ? `  ${alvo.descricao}` : '',
        '  Só leitura. Consulta de URL e valores de credencial saem tampados.',
        '',
        '# ONDE PROCUREI',
        ...ondeProcurei(v.raizes),
        '',
    ];
    if (v.achados.length === 0) {
        return [...cab, 'NENHUM LOG ENCONTRADO nas pastas acima.', 'Isto NÃO quer dizer que o robô não grava: pode gravar noutra conta ou noutro disco.'].join('\n');
    }
    const ordenados = [...v.achados].sort((a, b) => dataDoNome(b.nome) - dataDoNome(a.nome) || b.modificado.localeCompare(a.modificado));
    let tampadas = 0;
    const limpos = ordenados.map((a) => {
        const l = limparLog(a.conteudo);
        tampadas += l.tampadas;
        return { ...a, linhas: l.texto.split('\n').filter((x) => x.trim() !== '') };
    });
    const inventario = [
        `# ARQUIVOS (${limpos.length}, do mais recente)  nome;KB;linhas;modificado`,
        ...limpos.map((a) => `  ${a.nome};${Math.round(a.tamanho / 1024)};${a.linhas.length};${a.modificado.slice(0, 16)}`),
        '',
    ];
    const atencao: string[] = [];
    const fracas: string[] = [];
    for (const a of limpos.slice(0, DIAS_DE_ATENCAO)) {
        let nFracas = 0;
        for (const l of a.linhas) {
            if (LINHA_FORTE.test(l))
                atencao.push(`${a.nome} | ${l}`);
            else if (LINHA_FRACA.test(l))
                nFracas++;
        }
        if (nFracas)
            fracas.push(`  ${a.nome}  ${nFracas} linha(s) de "sessão"/"linha N" (contadas, não listadas)`);
    }
    const maisRecente = limpos[0]!;
    let trecho = maisRecente.linhas.slice(-LINHAS_DO_TRECHO);
    let atencaoMantida = atencao;
    const avisos: string[] = [];
    if (tampadas > 0)
        avisos.push(`# ${tampadas} linha(s) com cara de credencial saíram tampadas.`);
    const montar = () => [
        ...cab,
        ...inventario,
        `# LINHAS DE ATENCAO (${atencaoMantida.length} de ${atencao.length}, dos ${Math.min(DIAS_DE_ATENCAO, limpos.length)} arquivos mais recentes)`,
        ...atencaoMantida,
        '',
        ...(fracas.length ? ['# LINHAS FRACAS, por arquivo', ...fracas, ''] : []),
        `# TRECHO — as ${trecho.length} últimas linhas de ${maisRecente.nome}`,
        ...trecho,
        '',
        ...avisos,
    ].join('\n');
    let r = montar();
    while (tamanho(r) > teto && trecho.length > 20) {
        trecho = trecho.slice(Math.ceil(trecho.length / 4));
        r = montar();
    }
    while (tamanho(r) > teto && atencaoMantida.length > 0) {
        atencaoMantida = atencaoMantida.slice(0, Math.floor(atencaoMantida.length * 0.8));
        r = montar();
    }
    if (trecho.length < Math.min(LINHAS_DO_TRECHO, maisRecente.linhas.length) || atencaoMantida.length < atencao.length) {
        avisos.push('# CORTADO para caber na resposta: o trecho e/ou as linhas de atenção dos dias mais antigos.');
        r = montar();
        while (tamanho(r) > teto && trecho.length > 0) {
            trecho = trecho.slice(1);
            r = montar();
        }
    }
    return r;
}
