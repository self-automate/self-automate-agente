import type { Banco } from './banco-tipo.js';
import { registrar } from './log.js';
export interface ContaDeExecucao {
    nome: string;
    contaWindows: string;
    credencial: string;
    agentes?: string[];
    papeis?: string[];
    ativa?: boolean;
    manutencao?: JanelaDeManutencao | undefined;
}
export interface JanelaDeManutencao {
    inicio: string;
    fim: string;
}
export type ContaDeExecucaoGravada = Required<Omit<ContaDeExecucao, 'manutencao'>> & {
    manutencao?: JanelaDeManutencao;
    alteradoPor: string;
    alteradoEm: Date;
};
const HORA_MINUTO = /^([01]\d|2[0-3]):[0-5]\d$/;
export function janelaValida(x: {
    inicio?: string;
    fim?: string;
} | undefined): JanelaDeManutencao | undefined | null {
    if (x === undefined)
        return undefined;
    const { inicio = '', fim = '' } = x;
    if (!HORA_MINUTO.test(inicio) || !HORA_MINUTO.test(fim) || fim <= inicio)
        return null;
    return { inicio, fim };
}
const NOME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const nomeDeContaValido = (n: string): boolean => NOME.test(n);
const CONTA_WINDOWS = /^[^\\\r\n]+\\[^\\\r\n]+$/;
const CAMINHO_DO_COFRE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export function contaWindowsDoProcesso(env: Record<string, string | undefined> = process.env): string | undefined {
    return contaWindowsValida(env.USERDOMAIN && env.USERNAME ? `${env.USERDOMAIN}\\${env.USERNAME}` : undefined);
}
export function contaWindowsValida(x: unknown): string | undefined {
    return typeof x === 'string' && CONTA_WINDOWS.test(x) ? x : undefined;
}
export interface ContaDoJob {
    nome: string;
    contaWindows: string;
    credencial: string;
}
export function contaDoJobValida(x: unknown): ContaDoJob | undefined {
    if (!x || typeof x !== 'object')
        return undefined;
    const c = x as Record<string, unknown>;
    if (typeof c.nome !== 'string' || !NOME.test(c.nome))
        return undefined;
    const contaWindows = contaWindowsValida(c.contaWindows);
    if (!contaWindows || c.credencial !== `contas-de-execucao/${c.nome}`)
        return undefined;
    return { nome: c.nome, contaWindows, credencial: c.credencial };
}
export function sessaoDoJob(conta: ContaDoJob | undefined, contaDoProcesso: string | undefined): {
    ok: true;
    usuario?: string;
    caminho?: string;
} | {
    ok: false;
    motivo: string;
} {
    if (!conta)
        return { ok: true };
    if (!contaDoProcesso || contaDoProcesso.toLowerCase() !== conta.contaWindows.toLowerCase()) {
        return {
            ok: false,
            motivo: `este agente roda como ${contaDoProcesso ?? '(conta desconhecida)'}, e a conta de execução "${conta.nome}" é ${conta.contaWindows} — na Fase A da 0159 cada agente roda só a própria conta`,
        };
    }
    return { ok: true, usuario: conta.contaWindows.split('\\')[1]!, caminho: conta.credencial };
}
export function problemaDaContaDeExecucao(c: Pick<ContaDeExecucao, 'nome' | 'contaWindows' | 'credencial' | 'manutencao'>): string | undefined {
    if (c.manutencao !== undefined && janelaValida(c.manutencao) === null)
        return 'a janela de manutenção é HH:MM a HH:MM, com o fim depois do início';
    if (!NOME.test(c.nome))
        return 'o nome da conta de execução usa só minúsculas, dígitos e hífen (até 64)';
    if (!CONTA_WINDOWS.test(c.contaWindows))
        return 'a conta Windows precisa do domínio: DOMÍNIO\\conta (conta local: MÁQUINA\\conta)';
    if (/^pessoa(s|l)\//.test(c.credencial))
        return 'a credencial de uma conta de execução não pode ficar no espaço pessoal (pessoas/ ou pessoal/)';
    if (!CAMINHO_DO_COFRE.test(c.credencial))
        return 'a credencial é um caminho do cofre: segmentos de letra, dígito, _ e -, separados por /';
    return undefined;
}
export function resolverContaDeExecucao(n: {
    agora?: string | null;
    agendamento?: string | null;
    padraoDoRobo?: string | null;
}): string | undefined {
    for (const v of [n.agora, n.agendamento, n.padraoDoRobo])
        if (v)
            return v;
    return undefined;
}
const PAPEIS_QUE_ADMINISTRAM = ['administrador', 'equipe-rpa'];
export function podeUsarConta(c: Pick<ContaDeExecucao, 'papeis' | 'ativa'>, politicas: readonly string[]): boolean {
    if (c.ativa === false)
        return false;
    if (politicas.some((p) => PAPEIS_QUE_ADMINISTRAM.includes(p)))
        return true;
    return (c.papeis ?? []).some((p) => politicas.includes(p));
}
export function contasQueAPessoaPodeUsar<T extends Pick<ContaDeExecucao, 'papeis' | 'ativa'>>(contas: readonly T[], politicas: readonly string[]): T[] {
    return contas.filter((c) => podeUsarConta(c, politicas));
}
export type DecisaoDeConta = {
    ok: true;
    conta: string | null;
} | {
    ok: false;
    motivo: string;
};
function conferirConta(nome: string, contas: readonly Pick<ContaDeExecucaoGravada, 'nome' | 'ativa' | 'papeis'>[], politicas?: readonly string[]): DecisaoDeConta {
    const c = contas.find((x) => x.nome === nome);
    if (!c)
        return { ok: false, motivo: `a conta de execução "${nome}" não existe` };
    if (!c.ativa)
        return { ok: false, motivo: `a conta de execução "${nome}" está desligada` };
    if (politicas && !podeUsarConta(c, politicas))
        return { ok: false, motivo: `o seu papel não pode usar a conta de execução "${nome}"` };
    return { ok: true, conta: nome };
}
export function decidirExecutarComo(n: {
    agora?: string | null | undefined;
    padraoDoRobo?: string | null | undefined;
}, contas: readonly Pick<ContaDeExecucaoGravada, 'nome' | 'ativa' | 'papeis'>[], politicas: readonly string[]): DecisaoDeConta {
    const nome = resolverContaDeExecucao({ agora: n.agora ?? null, padraoDoRobo: n.padraoDoRobo ?? null });
    return nome ? conferirConta(nome, contas, politicas) : { ok: true, conta: null };
}
export async function salvarContaDeExecucao(banco: Banco, c: ContaDeExecucao, por: string): Promise<void> {
    const problema = problemaDaContaDeExecucao(c);
    if (problema)
        throw new Error(problema);
    await banco.pool.query(`INSERT INTO contas_de_execucao (nome, conta_windows, credencial, agentes, papeis, ativa, manutencao_inicio, manutencao_fim, alterado_por, alterado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (nome) DO UPDATE
        SET conta_windows     = EXCLUDED.conta_windows,
            credencial        = EXCLUDED.credencial,
            agentes           = EXCLUDED.agentes,
            papeis            = EXCLUDED.papeis,
            ativa             = EXCLUDED.ativa,
            manutencao_inicio = EXCLUDED.manutencao_inicio,
            manutencao_fim    = EXCLUDED.manutencao_fim,
            alterado_por      = EXCLUDED.alterado_por,
            alterado_em       = now()`, [c.nome, c.contaWindows, c.credencial, c.agentes ?? [], c.papeis ?? [], c.ativa ?? true, c.manutencao?.inicio ?? null, c.manutencao?.fim ?? null, por]);
    registrar('aviso', 'conta de execução gravada', { nome: c.nome, contaWindows: c.contaWindows, ativa: c.ativa ?? true, por });
}
export async function lerContasDeExecucao(banco: Banco): Promise<ContaDeExecucaoGravada[]> {
    const { rows } = await banco.pool.query(`SELECT nome, conta_windows, credencial, agentes, papeis, ativa, manutencao_inicio, manutencao_fim, alterado_por, alterado_em
       FROM contas_de_execucao ORDER BY nome`);
    return rows.map((r) => ({
        nome: r.nome as string,
        contaWindows: r.conta_windows as string,
        credencial: r.credencial as string,
        agentes: r.agentes as string[],
        papeis: r.papeis as string[],
        ativa: r.ativa as boolean,
        ...(r.manutencao_inicio && r.manutencao_fim
            ? { manutencao: { inicio: r.manutencao_inicio as string, fim: r.manutencao_fim as string } }
            : {}),
        alteradoPor: r.alterado_por as string,
        alteradoEm: r.alterado_em as Date,
    }));
}
export async function associarRoboAConta(banco: Banco, robo: string, conta: string | null, por: string): Promise<void> {
    if (conta === null) {
        await banco.pool.query('DELETE FROM robos_conta_de_execucao WHERE robo = $1', [robo]);
    }
    else {
        await banco.pool.query(`INSERT INTO robos_conta_de_execucao (robo, conta, alterado_por, alterado_em)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (robo) DO UPDATE
          SET conta = EXCLUDED.conta, alterado_por = EXCLUDED.alterado_por, alterado_em = now()`, [robo, conta, por]);
    }
    registrar('aviso', 'robô associado a conta de execução', { robo, conta: conta ?? '(conta do agente)', por });
}
export async function anunciarContaDoAgente(banco: Banco, nome: string, conta: string | null): Promise<void> {
    await banco.pool.query('UPDATE agentes SET conta_windows = $2, conta_windows_em = now() WHERE nome = $1', [nome, conta]);
}
export async function contaDoJob(banco: Banco, job: string): Promise<{
    nome: string;
    credencial: string;
} | undefined> {
    if (!/^\d+$/.test(job))
        return undefined;
    const { rows } = await banco.pool.query(`SELECT c.nome, c.credencial
       FROM execucoes e
       JOIN pedidos_execucao p ON p.id = e.pedido
       JOIN contas_de_execucao c ON c.nome = p.conta_de_execucao
      WHERE e.id = $1 AND c.ativa`, [job]);
    return rows[0] ? { nome: rows[0].nome as string, credencial: rows[0].credencial as string } : undefined;
}
export async function anotarRodouComo(banco: Banco, execucao: string, conta: string): Promise<void> {
    await banco.pool.query('UPDATE execucoes SET rodou_como = $2 WHERE id = $1', [Number(execucao), conta]);
}
export async function definirContaDoAgendamento(banco: Banco, robo: string, conta: string | null): Promise<void> {
    await banco.pool.query('UPDATE agendamentos SET conta_de_execucao = $2 WHERE robo = $1', [robo, conta]);
}
export async function contaDoAgendamento(banco: Banco, robo: string): Promise<string | undefined> {
    const { rows } = await banco.pool.query('SELECT conta_de_execucao FROM agendamentos WHERE robo = $1', [robo]);
    return (rows[0]?.conta_de_execucao as string | null | undefined) ?? undefined;
}
export async function contaParaOAgendamento(banco: Banco, robo: string): Promise<DecisaoDeConta> {
    const nome = resolverContaDeExecucao({
        agendamento: (await contaDoAgendamento(banco, robo)) ?? null,
        padraoDoRobo: (await contaPadraoDoRobo(banco, robo)) ?? null,
    });
    return nome ? conferirConta(nome, await lerContasDeExecucao(banco)) : { ok: true, conta: null };
}
export interface FilaDaConta {
    pendentes: {
        pedido: number;
        robo: string;
        por: string;
        desde: Date;
    }[];
    ocupadaPor?: {
        execucao: number;
        robo: string;
        desde: Date;
    };
    agenteComAConta: boolean;
}
export function motivoDaEspera(f: {
    ativa: boolean;
    agenteComAConta: boolean;
    ocupadaPor?: {
        execucao: number;
        robo: string;
    } | undefined;
}): string {
    if (!f.ativa)
        return 'a conta está desligada: nada sai até ligá-la';
    if (f.ocupadaPor)
        return `conta ocupada pela execução ${f.ocupadaPor.execucao} (${f.ocupadaPor.robo}) — uma por vez`;
    if (!f.agenteComAConta)
        return 'nenhum agente com esta conta anunciou nos últimos 2 minutos';
    return 'livre — aguardando o agente retirar';
}
export async function filaDaConta(banco: Banco, conta: string): Promise<FilaDaConta> {
    const { rows: pend } = await banco.pool.query(`SELECT id, robo, pedido_por, pedido_em FROM pedidos_execucao
      WHERE atendido_em IS NULL AND conta_de_execucao = $1 ORDER BY id`, [conta]);
    const { rows: oc } = await banco.pool.query(`SELECT e.id, e.robo, e.inicio FROM execucoes e JOIN pedidos_execucao p ON p.id = e.pedido
      WHERE e.status = 'EXECUTANDO' AND p.conta_de_execucao = $1 ORDER BY e.id LIMIT 1`, [conta]);
    const { rows: ag } = await banco.pool.query(`SELECT EXISTS (
       SELECT 1 FROM agentes a JOIN contas_de_execucao c ON c.nome = $1
        WHERE lower(a.conta_windows) = lower(c.conta_windows)
          AND a.conta_windows_em > now() - interval '2 minutes'
          AND (cardinality(c.agentes) = 0 OR a.nome = ANY(c.agentes))) AS tem`, [conta]);
    return {
        pendentes: pend.map((r) => ({ pedido: Number(r.id), robo: r.robo as string, por: r.pedido_por as string, desde: r.pedido_em as Date })),
        ...(oc[0] ? { ocupadaPor: { execucao: Number(oc[0].id), robo: oc[0].robo as string, desde: oc[0].inicio as Date } } : {}),
        agenteComAConta: ag[0]?.tem === true,
    };
}
export async function esperaMediaDaConta(banco: Banco, conta: string, dias = 7): Promise<number | undefined> {
    const { rows } = await banco.pool.query(`SELECT avg(extract(epoch FROM (e.inicio - p.pedido_em))) / 60 AS minutos
       FROM execucoes e JOIN pedidos_execucao p ON p.id = e.pedido
      WHERE p.conta_de_execucao = $1 AND e.inicio > now() - make_interval(days => $2::int)`, [conta, dias]);
    const m = rows[0]?.minutos;
    return m === null || m === undefined ? undefined : Number(m);
}
export async function agendamentosComConta(banco: Banco): Promise<{
    robo: string;
    expressao: string;
    ativo: boolean;
    conta?: string;
}[]> {
    const { rows } = await banco.pool.query('SELECT robo, expressao, ativo, conta_de_execucao FROM agendamentos ORDER BY robo');
    return rows.map((r) => ({
        robo: r.robo as string,
        expressao: r.expressao as string,
        ativo: r.ativo as boolean,
        ...(r.conta_de_execucao ? { conta: r.conta_de_execucao as string } : {}),
    }));
}
export async function lerAssociacoes(banco: Banco): Promise<Map<string, string>> {
    const { rows } = await banco.pool.query('SELECT robo, conta FROM robos_conta_de_execucao ORDER BY robo');
    return new Map(rows.map((r) => [r.robo as string, r.conta as string]));
}
export async function contaPadraoDoRobo(banco: Banco, robo: string): Promise<string | undefined> {
    const { rows } = await banco.pool.query('SELECT conta FROM robos_conta_de_execucao WHERE robo = $1', [robo]);
    return (rows[0]?.conta as string | undefined) ?? undefined;
}
