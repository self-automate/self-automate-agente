import type { Banco } from './banco-tipo.js';
import { dominiosDeValidacao } from './organizacao.js';
export const ROTEIRO = [
    { campo: 'oQueFaz', rotulo: 'O que se faz hoje à mão', pergunta: 'O que você faz hoje à mão, que gostaria que um robô fizesse?' },
    { campo: 'sistemas', rotulo: 'Sistemas', pergunta: 'Em quais sistemas isso acontece?' },
    { campo: 'frequencia', rotulo: 'Frequência', pergunta: 'Com que frequência você faz isso, e quanto tempo leva?' },
    { campo: 'deOnde', rotulo: 'De onde vem o dado', pergunta: 'De onde vem o dado que você usa? Um arquivo, uma tela, um e-mail?' },
    { campo: 'paraOnde', rotulo: 'Para onde vai', pergunta: 'Para onde vai o resultado?' },
    { campo: 'dono', rotulo: 'Dono na área', pergunta: 'Quem é o dono desse processo na sua área?' },
] as const;
export type Campo = (typeof ROTEIRO)[number]['campo'];
export type Respostas = Record<Campo, string>;
export const SITUACOES = [
    { valor: 'recebido', rotulo: 'recebido' },
    { valor: 'em-analise', rotulo: 'em análise' },
    { valor: 'precisa-de-resposta', rotulo: 'precisa de resposta' },
    { valor: 'em-desenvolvimento', rotulo: 'em desenvolvimento' },
    { valor: 'em-validacao', rotulo: 'em validação' },
    { valor: 'entregue', rotulo: 'entregue' },
    { valor: 'recusado', rotulo: 'recusado' },
] as const;
export type Situacao = (typeof SITUACOES)[number]['valor'];
export const ehSituacao = (v: string): v is Situacao => SITUACOES.some((s) => s.valor === v);
export const rotuloDaSituacao = (s: Situacao) => SITUACOES.find((x) => x.valor === s)!.rotulo;
export type Lado = 'quem-pediu' | 'equipe';
export const FASES_DA_LEITURA = ['', 'desenvolvendo', 'aguardando-aprovacao', 'publicado'] as const;
export type FaseDaLeitura = (typeof FASES_DA_LEITURA)[number];
export const ehFaseDaLeitura = (v: string): v is FaseDaLeitura => (FASES_DA_LEITURA as readonly string[]).includes(v);
export const PRAZO_DA_TRAVA_MS = 3 * 60 * 60 * 1000;
export const travaViva = (p: Pick<PedidoDeAutomacao, 'travaEm'>, agora: Date = new Date()): boolean => p.travaEm !== undefined && agora.getTime() - p.travaEm.getTime() < PRAZO_DA_TRAVA_MS;
export function pedeAtencao(p: Pick<PedidoDeAutomacao, 'lidoAte'>, mensagens: readonly Pick<MensagemDoPedido, 'lado'>[]): boolean {
    const lido = p.lidoAte ?? -1;
    if (lido < 0)
        return true;
    return mensagens.length > lido && mensagens.at(-1)!.lado === 'quem-pediu';
}
export interface NovoPedido extends Respostas {
    criadoPor: string;
    titulo: string;
}
export interface RascunhoDoPedido {
    texto: string;
    situacao: Situacao | '';
    pontos: string;
    por: string;
    em: Date;
}
export interface PedidoDeAutomacao extends NovoPedido {
    id: number;
    criadoEm: Date;
    situacao: Situacao;
    motivo: string;
    robo: string;
    rascunho?: RascunhoDoPedido;
    caixaDeValidacao?: string;
    ondeRoda?: 'empresa' | 'pessoal';
    credenciaisPessoais?: string[];
    fase?: FaseDaLeitura;
    branch?: string;
    lidoAte?: number;
    travaEm?: Date;
    novasParaQuemPediu?: number;
}
export interface MensagemDoPedido {
    id: number;
    pedido: number;
    autor: string;
    lado: Lado;
    texto: string;
    criadoEm: Date;
}
export interface RepositorioDePedidos {
    criar(p: NovoPedido): Promise<number>;
    listar(f: {
        criadoPor?: string;
    }): Promise<PedidoDeAutomacao[]>;
    ler(id: number): Promise<PedidoDeAutomacao | undefined>;
    mensagens(id: number): Promise<MensagemDoPedido[]>;
    acrescentarMensagem(m: Omit<MensagemDoPedido, 'id' | 'criadoEm'>): Promise<void>;
    mudarSituacao(id: number, situacao: Situacao, motivo?: string): Promise<void>;
    guardarRascunho(id: number, r: Omit<RascunhoDoPedido, 'em'>): Promise<void>;
    descartarRascunho(id: number): Promise<void>;
    vincularRobo(id: number, robo: string, caixa: string): Promise<void>;
    dominiosDeValidacao?(): Promise<string[]>;
    gravarOndeRoda(id: number, onde: 'empresa' | 'pessoal'): Promise<void>;
    gravarCredenciaisPessoais(id: number, nomes: readonly string[]): Promise<void>;
    marcarLeitura(id: number, m: {
        fase?: FaseDaLeitura;
        branch?: string;
        lidoAte?: number;
    }): Promise<void>;
    travar(id: number, agora?: Date): Promise<boolean>;
    destravar(id: number): Promise<void>;
    marcarVistoPorQuemPediu(id: number): Promise<void>;
    registrarPassagem(): Promise<void>;
    ultimaPassagem(): Promise<Date | undefined>;
}
export const HORARIO_DA_LEITURA = { primeira: 8, ultima: 18, fuso: 'America/Sao_Paulo' } as const;
export const TOLERANCIA_DA_LEITURA_MS = 30 * 60000;
export interface EstadoDaFila {
    parada: boolean;
    texto: string;
}
const HORA_MS = 60 * 60000;
function emBrasilia(d: Date): {
    diaDaSemana: number;
    hora: number;
    dia: string;
    hhmm: string;
} {
    const f = new Intl.DateTimeFormat('en-US', {
        timeZone: HORARIO_DA_LEITURA.fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hourCycle: 'h23',
    });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { diaDaSemana: dias[p.weekday ?? ''] ?? 0, hora: Number(p.hour), dia: `${p.day}/${p.month}`, hhmm: `${p.hour}:${p.minute}` };
}
function ultimaPassagemEsperada(limite: Date): Date {
    let t = new Date(Math.floor(limite.getTime() / HORA_MS) * HORA_MS);
    for (let i = 0; i < 24 * 8; i++) {
        const b = emBrasilia(t);
        if (b.diaDaSemana >= 1 && b.diaDaSemana <= 5 && b.hora >= HORARIO_DA_LEITURA.primeira && b.hora <= HORARIO_DA_LEITURA.ultima)
            return t;
        t = new Date(t.getTime() - HORA_MS);
    }
    return t;
}
export function estadoDaFila(passouEm: Date | undefined, agora: Date): EstadoDaFila {
    if (!passouEm)
        return { parada: true, texto: 'A leitura automática ainda não registrou nenhuma passagem.' };
    const b = emBrasilia(passouEm);
    const quando = emBrasilia(agora).dia === b.dia ? `às ${b.hhmm} de hoje` : `em ${b.dia} às ${b.hhmm}`;
    const esperada = ultimaPassagemEsperada(new Date(agora.getTime() - TOLERANCIA_DA_LEITURA_MS));
    return passouEm.getTime() < esperada.getTime()
        ? { parada: true, texto: `A leitura automática não passa desde ${quando}: os pedidos não estão sendo lidos.` }
        : { parada: false, texto: `A leitura automática passou ${quando}.` };
}
export const TETO_DO_TEXTO = 2000;
const PALAVRA = String.raw `\b(?:senha|password|passwd|pwd|token|secret|segredo|api[ _-]?key|chave\s+de\s+(?:api|acesso))`;
const ATRIBUIDA = new RegExp(PALAVRA + String.raw `\s*(?:[:=]|\s(?:é|eh|e|era|seria)\s)\s*["'“]?([^\s"'”]+)`, 'giu');
const valorComCaraDeSegredo = (bruto: string) => {
    const v = bruto.replace(/[.,;:!?)\]]+$/u, '');
    return v.length >= 4 && (/\d/u.test(v) || /[^\p{L}\d]/u.test(v) || /\p{Lu}/u.test(v.slice(1)));
};
const soltoEAleatorio = (pedaco: string) => {
    const p = pedaco.replace(/^[("'“]+|[.,;:!?)"'”]+$/gu, '');
    return /^[A-Za-z0-9+=-]{20,}$/.test(p) && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p);
};
export function pareceSenha(texto: string): boolean {
    for (const m of texto.matchAll(ATRIBUIDA))
        if (valorComCaraDeSegredo(m[1]!))
            return true;
    return texto.split(/\s+/u).some(soltoEAleatorio);
}
const RECUSA_DE_SENHA = 'Não escreva senha aqui: se o robô precisar entrar num sistema, a equipe cuida da credencial pelo cofre. Reescreva sem ela.';
export function tituloDoPedido(oQueFaz: string): string {
    const frase = oQueFaz.trim().split(/[.!?\n]/u)[0]!.trim();
    return frase.length <= 80 ? frase : frase.slice(0, 79).trimEnd() + '…';
}
export type PedidoLido = {
    ok: true;
    pedido: Respostas & {
        titulo: string;
    };
} | {
    ok: false;
    erro: string;
    campo: Campo;
    respostas: Respostas;
};
export function lerPedidoNovo(form: URLSearchParams): PedidoLido {
    const respostas = Object.fromEntries(ROTEIRO.map((r) => [r.campo, (form.get(r.campo) ?? '').trim()])) as Respostas;
    for (const r of ROTEIRO) {
        const v = respostas[r.campo];
        if (!v)
            return { ok: false, erro: `Falta responder: "${r.rotulo}".`, campo: r.campo, respostas };
        if (v.length > TETO_DO_TEXTO) {
            return { ok: false, erro: `A resposta de "${r.rotulo}" passou de 2.000 caracteres. Resuma; o detalhe vem na conversa.`, campo: r.campo, respostas };
        }
        if (pareceSenha(v)) {
            return { ok: false, erro: `A resposta de "${r.rotulo}" parece ter uma senha. ${RECUSA_DE_SENHA}`, campo: r.campo, respostas: { ...respostas, [r.campo]: '' } };
        }
    }
    return { ok: true, pedido: { ...respostas, titulo: tituloDoPedido(respostas.oQueFaz) } };
}
export function lerMensagem(bruto: string): {
    ok: true;
    texto: string;
} | {
    ok: false;
    erro: string;
} {
    const texto = bruto.trim();
    if (!texto)
        return { ok: false, erro: 'Escreva a mensagem antes de enviar.' };
    if (texto.length > TETO_DO_TEXTO)
        return { ok: false, erro: 'A mensagem passou de 2.000 caracteres. Divida em duas.' };
    if (pareceSenha(texto))
        return { ok: false, erro: `A mensagem parece ter uma senha. ${RECUSA_DE_SENHA}` };
    return { ok: true, texto };
}
export function lerRascunho(texto: string, situacao: string, pontos: string): {
    ok: true;
    rascunho: Pick<RascunhoDoPedido, 'texto' | 'situacao' | 'pontos'>;
} | {
    ok: false;
    erro: string;
} {
    const lida = lerMensagem(texto);
    if (!lida.ok)
        return lida;
    if (situacao !== '' && !ehSituacao(situacao))
        return { ok: false, erro: `Situação desconhecida: ${situacao}.` };
    const p = pontos.trim();
    if (p.length > TETO_DO_TEXTO)
        return { ok: false, erro: 'Os pontos passaram de 2.000 caracteres.' };
    if (pareceSenha(p))
        return { ok: false, erro: `Os pontos parecem ter uma senha. ${RECUSA_DE_SENHA}` };
    return { ok: true, rascunho: { texto: lida.texto, situacao: situacao as Situacao | '', pontos: p } };
}
export function lerCaixaDeValidacao(bruto: string, dominios: readonly string[]): {
    ok: true;
    caixa: string;
} | {
    ok: false;
    erro: string;
} {
    const caixa = bruto.trim().toLowerCase();
    if (!caixa)
        return { ok: true, caixa: '' };
    const partes = /^([a-z0-9._%+-]+)@([a-z0-9.-]+)$/.exec(caixa);
    if (!partes)
        return { ok: false, erro: 'A caixa de validação precisa ser UM endereço de e-mail.' };
    if (!dominios.length) {
        return { ok: false, erro: 'Nenhum domínio de validação está configurado nesta instalação: o Administrador configura em Setup > Organização.' };
    }
    if (!dominios.includes(partes[2]!)) {
        return { ok: false, erro: `O domínio ${partes[2]} não está entre os permitidos para teste: ${dominios.join(', ')}.` };
    }
    return { ok: true, caixa };
}
export function lerNomeDeRobo(bruto: string): {
    ok: true;
    robo: string;
} | {
    ok: false;
    erro: string;
} {
    const robo = bruto.trim();
    if (!robo)
        return { ok: true, robo: '' };
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(robo))
        return { ok: false, erro: 'O nome do robô usa só letras minúsculas, dígitos e hífen.' };
    return { ok: true, robo };
}
export function situacaoDepoisDaMensagem(atual: Situacao, lado: Lado): Situacao {
    return lado === 'quem-pediu' && atual === 'precisa-de-resposta' ? 'em-analise' : atual;
}
export interface AvisoDePedido {
    tipo: 'novo' | 'resposta' | 'entregue' | 'reaberto' | 'ajuste';
    pedido: number;
    titulo: string;
    quem: string;
}
export function destinatariosDoAviso(bruto: string | undefined): string[] {
    return (bruto ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}
export function mensagemDoAviso(a: AvisoDePedido, endereco: string): {
    assunto: string;
    corpo: string;
} {
    const ficha = `${endereco.replace(/\/+$/, '')}/pedidos/${a.pedido}`;
    if (a.tipo === 'novo') {
        return {
            assunto: `Pedido de automação nº ${a.pedido}, de ${a.quem}`,
            corpo: `${a.quem} pediu uma automação:\n\n  ${a.titulo}\n\nAbrir a ficha: ${ficha}\n\nAs respostas do pedido ficam no console, e não neste e-mail.`,
        };
    }
    if (a.tipo === 'entregue') {
        return {
            assunto: `Pedido nº ${a.pedido}: ${a.quem} confirmou a entrega`,
            corpo: `${a.quem} confirmou que o robô está funcionando como combinado, e o pedido foi encerrado como entregue:\n\n  ${a.titulo}\n\nAbrir a ficha: ${ficha}`,
        };
    }
    if (a.tipo === 'reaberto') {
        return {
            assunto: `Pedido nº ${a.pedido}: ${a.quem} disse que algo está errado`,
            corpo: `${a.quem} disse que o robô não está como combinado, e o pedido voltou para em desenvolvimento:\n\n  ${a.titulo}\n\nLer o que está errado: ${ficha}#conversa`,
        };
    }
    if (a.tipo === 'ajuste') {
        return {
            assunto: `Pedido nº ${a.pedido}: ${a.quem} pediu um ajuste`,
            corpo: `${a.quem} pediu um ajuste num pedido encerrado, e ele voltou para em análise:\n\n  ${a.titulo}\n\nLer o que precisa mudar: ${ficha}#conversa`,
        };
    }
    return {
        assunto: `Pedido nº ${a.pedido}: ${a.quem} respondeu`,
        corpo: `${a.quem} respondeu na conversa do pedido:\n\n  ${a.titulo}\n\nLer a conversa: ${ficha}#conversa`,
    };
}
const COLUNAS = `id, criado_por, criado_em, titulo, o_que_faz, sistemas, frequencia, de_onde, para_onde, dono, situacao, motivo, robo,
  rascunho, rascunho_situacao, rascunho_pontos, rascunho_por, rascunho_em, caixa_de_validacao, onde_roda, credenciais_pessoais,
  fase, branch, lido_ate, trava_em,
  (SELECT count(*) FROM mensagens_do_pedido m
    WHERE m.pedido = pedidos_de_automacao.id AND m.lado = 'equipe'
      AND m.id > pedidos_de_automacao.visto_por_quem_pediu)::int AS novas_para_quem_pediu`;
const pedidoDaLinha = (l: Record<string, unknown>): PedidoDeAutomacao => ({
    id: Number(l.id),
    criadoPor: String(l.criado_por),
    criadoEm: l.criado_em as Date,
    titulo: String(l.titulo),
    oQueFaz: String(l.o_que_faz),
    sistemas: String(l.sistemas),
    frequencia: String(l.frequencia),
    deOnde: String(l.de_onde),
    paraOnde: String(l.para_onde),
    dono: String(l.dono),
    situacao: String(l.situacao) as Situacao,
    motivo: String(l.motivo),
    robo: String(l.robo),
    ...(l.rascunho
        ? {
            rascunho: {
                texto: String(l.rascunho),
                situacao: String(l.rascunho_situacao) as Situacao | '',
                pontos: String(l.rascunho_pontos),
                por: String(l.rascunho_por),
                em: l.rascunho_em as Date,
            },
        }
        : {}),
    ...(l.caixa_de_validacao ? { caixaDeValidacao: String(l.caixa_de_validacao) } : {}),
    ...(l.onde_roda === 'pessoal' ? { ondeRoda: 'pessoal' as const } : {}),
    credenciaisPessoais: Array.isArray(l.credenciais_pessoais) ? (l.credenciais_pessoais as unknown[]).map(String) : [],
    fase: String(l.fase ?? '') as FaseDaLeitura,
    branch: String(l.branch ?? ''),
    lidoAte: Number(l.lido_ate ?? -1),
    ...(l.trava_em ? { travaEm: l.trava_em as Date } : {}),
    novasParaQuemPediu: Number(l.novas_para_quem_pediu ?? 0),
});
export async function validacaoDoRobo(banco: Banco, robo: string): Promise<{
    pedido: number;
    caixa: string;
    dominios: string[];
} | undefined> {
    const { rows } = await banco.pool.query(`SELECT id, caixa_de_validacao FROM pedidos_de_automacao
      WHERE robo = $1 AND caixa_de_validacao <> '' AND situacao NOT IN ('entregue', 'recusado')
      ORDER BY id DESC LIMIT 1`, [robo]);
    return rows[0] ? { pedido: Number(rows[0].id), caixa: String(rows[0].caixa_de_validacao), dominios: await dominiosDeValidacao(banco) } : undefined;
}
export async function studioIaLigado(banco: Banco, usuario: string): Promise<boolean> {
    const { rows } = await banco.pool.query('SELECT ligado FROM studio_ia_por_usuario WHERE usuario = $1', [usuario]);
    return rows[0]?.ligado === true;
}
export async function listarStudioIa(banco: Banco): Promise<Set<string>> {
    const { rows } = await banco.pool.query('SELECT usuario FROM studio_ia_por_usuario WHERE ligado');
    return new Set(rows.map((r) => String(r.usuario)));
}
export async function gravarStudioIa(banco: Banco, usuario: string, ligado: boolean, por: string): Promise<void> {
    await banco.pool.query(`INSERT INTO studio_ia_por_usuario (usuario, ligado, alterado_por) VALUES ($1, $2, $3)
     ON CONFLICT (usuario) DO UPDATE SET ligado = EXCLUDED.ligado, alterado_por = EXCLUDED.alterado_por, alterado_em = now()`, [usuario, ligado, por]);
}
export async function contarMensagensNovas(banco: Banco, usuario: string): Promise<number> {
    const { rows } = await banco.pool.query(`SELECT count(*)::int AS n FROM mensagens_do_pedido m JOIN pedidos_de_automacao p ON p.id = m.pedido
      WHERE p.criado_por = $1 AND m.lado = 'equipe' AND m.id > p.visto_por_quem_pediu`, [usuario]);
    return Number(rows[0].n);
}
export async function contarRascunhosParaAprovar(banco: Banco): Promise<number> {
    const { rows } = await banco.pool.query(`SELECT count(*)::int AS n FROM pedidos_de_automacao WHERE rascunho <> ''`);
    return Number(rows[0].n);
}
const CHAVE_DA_PASSAGEM = 'pedidos:leitura-passou';
const TRANCA_DA_LEITURA = 20260930;
export function repositorioNoBanco(banco: Banco): RepositorioDePedidos {
    return {
        async criar(p) {
            const { rows } = await banco.pool.query(`INSERT INTO pedidos_de_automacao (criado_por, titulo, o_que_faz, sistemas, frequencia, de_onde, para_onde, dono)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [p.criadoPor, p.titulo, p.oQueFaz, p.sistemas, p.frequencia, p.deOnde, p.paraOnde, p.dono]);
            return Number(rows[0].id);
        },
        async listar(f) {
            const { rows } = f.criadoPor === undefined
                ? await banco.pool.query(`SELECT ${COLUNAS} FROM pedidos_de_automacao ORDER BY id DESC`)
                : await banco.pool.query(`SELECT ${COLUNAS} FROM pedidos_de_automacao WHERE criado_por = $1 ORDER BY id DESC`, [f.criadoPor]);
            return rows.map(pedidoDaLinha);
        },
        async ler(id) {
            const { rows } = await banco.pool.query(`SELECT ${COLUNAS} FROM pedidos_de_automacao WHERE id = $1`, [id]);
            return rows[0] ? pedidoDaLinha(rows[0]) : undefined;
        },
        async mensagens(id) {
            const { rows } = await banco.pool.query(`SELECT id, pedido, autor, lado, texto, criado_em FROM mensagens_do_pedido WHERE pedido = $1 ORDER BY id`, [id]);
            return rows.map((l) => ({
                id: Number(l.id),
                pedido: Number(l.pedido),
                autor: String(l.autor),
                lado: l.lado as Lado,
                texto: String(l.texto),
                criadoEm: l.criado_em as Date,
            }));
        },
        async acrescentarMensagem(m) {
            await banco.pool.query(`INSERT INTO mensagens_do_pedido (pedido, autor, lado, texto) VALUES ($1, $2, $3, $4)`, [m.pedido, m.autor, m.lado, m.texto]);
            await banco.pool.query(`UPDATE pedidos_de_automacao SET atualizado_em = now() WHERE id = $1`, [m.pedido]);
        },
        async guardarRascunho(id, r) {
            await banco.pool.query(`UPDATE pedidos_de_automacao SET rascunho = $2, rascunho_situacao = $3, rascunho_pontos = $4, rascunho_por = $5, rascunho_em = now() WHERE id = $1`, [id, r.texto, r.situacao, r.pontos, r.por]);
        },
        async marcarLeitura(id, m) {
            const campos: string[] = [];
            const valores: unknown[] = [id];
            if (m.fase !== undefined) {
                valores.push(m.fase);
                campos.push(`fase = $${valores.length}`);
            }
            if (m.branch !== undefined) {
                valores.push(m.branch);
                campos.push(`branch = $${valores.length}`);
            }
            if (m.lidoAte !== undefined) {
                valores.push(m.lidoAte);
                campos.push(`lido_ate = $${valores.length}`);
            }
            if (!campos.length)
                return;
            await banco.pool.query(`UPDATE pedidos_de_automacao SET ${campos.join(', ')} WHERE id = $1`, valores);
        },
        async travar(id, agora = new Date()) {
            const c = await banco.pool.connect();
            try {
                await c.query('BEGIN');
                await c.query('SELECT pg_advisory_xact_lock($1)', [TRANCA_DA_LEITURA]);
                const { rowCount } = await c.query(`UPDATE pedidos_de_automacao SET trava_em = $2
            WHERE id = $1 AND NOT EXISTS (
              SELECT 1 FROM pedidos_de_automacao WHERE trava_em > $2::timestamptz - interval '3 hours')`, [id, agora]);
                await c.query('COMMIT');
                return rowCount === 1;
            }
            catch (erro) {
                await c.query('ROLLBACK').catch(() => undefined);
                throw erro;
            }
            finally {
                c.release();
            }
        },
        async destravar(id) {
            await banco.pool.query('UPDATE pedidos_de_automacao SET trava_em = NULL WHERE id = $1', [id]);
        },
        async registrarPassagem() {
            await banco.pool.query(`INSERT INTO parametros (chave, valor, alterado_por) VALUES ($1, 'passou', 'leitura-automatica')
         ON CONFLICT (chave) DO UPDATE SET alterado_em = now(), alterado_por = EXCLUDED.alterado_por`, [CHAVE_DA_PASSAGEM]);
        },
        async ultimaPassagem() {
            const { rows } = await banco.pool.query('SELECT alterado_em FROM parametros WHERE chave = $1', [CHAVE_DA_PASSAGEM]);
            return rows[0] ? (rows[0].alterado_em as Date) : undefined;
        },
        async marcarVistoPorQuemPediu(id) {
            await banco.pool.query(`UPDATE pedidos_de_automacao
            SET visto_por_quem_pediu = COALESCE((SELECT max(id) FROM mensagens_do_pedido WHERE pedido = $1), 0)
          WHERE id = $1`, [id]);
        },
        async gravarCredenciaisPessoais(id, nomes) {
            await banco.pool.query('UPDATE pedidos_de_automacao SET credenciais_pessoais = $2::text[], atualizado_em = now() WHERE id = $1', [id, [...nomes]]);
        },
        dominiosDeValidacao: () => dominiosDeValidacao(banco),
        async gravarOndeRoda(id, onde) {
            await banco.pool.query('UPDATE pedidos_de_automacao SET onde_roda = $2, atualizado_em = now() WHERE id = $1', [id, onde]);
        },
        async vincularRobo(id, robo, caixa) {
            await banco.pool.query(`UPDATE pedidos_de_automacao SET robo = $2, caixa_de_validacao = $3, atualizado_em = now() WHERE id = $1`, [id, robo, caixa]);
        },
        async descartarRascunho(id) {
            await banco.pool.query(`UPDATE pedidos_de_automacao SET rascunho = '', rascunho_situacao = '', rascunho_pontos = '', rascunho_por = '', rascunho_em = NULL WHERE id = $1`, [id]);
        },
        async mudarSituacao(id, situacao, motivo = '') {
            await banco.pool.query(`UPDATE pedidos_de_automacao SET situacao = $2, motivo = $3, atualizado_em = now() WHERE id = $1`, [id, situacao, motivo]);
        },
    };
}
