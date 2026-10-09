import { registrar } from './log.js';
import { identidadeDoAplicativo, campoDa, renovarAcessoDeEmail, caixaDeEnvio, ehAutorizacaoVencida, ehNaoAutorizado, } from './acesso-de-email.js';
export { ehNaoAutorizado, ehAutorizacaoVencida, CAUSA_NAO_AUTORIZADO, CAUSA_AUTORIZACAO_VENCIDA, } from './acesso-de-email.js';
const GRAFO = 'https://graph.microsoft.com/v1.0';
export interface Anexo {
    nome: string;
    conteudo: Uint8Array;
    tipo?: string;
    idEmbutido?: string;
}
export interface Mensagem {
    para: string[];
    cc?: string[];
    assunto: string;
    corpo: string;
    html?: boolean;
    anexos?: Anexo[];
}
interface MensagemDoGrafo {
    message: {
        subject: string;
        body: {
            contentType: 'Text' | 'HTML';
            content: string;
        };
        toRecipients: {
            emailAddress: {
                address: string;
            };
        }[];
        ccRecipients: {
            emailAddress: {
                address: string;
            };
        }[];
        attachments: {
            '@odata.type': string;
            name: string;
            contentType: string;
            contentBytes: string;
            isInline?: boolean;
            contentId?: string;
        }[];
    };
    saveToSentItems: true;
}
export function corpoComAvisoDeTeste(m: Mensagem, testePara?: string): string {
    if (!testePara)
        return m.corpo;
    const reais = [...m.para, ...(m.cc ?? [])].join(', ');
    return m.html
        ? `${m.corpo}<hr><div style="background:#fff3cd;border:2px solid #b8860b;padding:12px;` +
            `font-family:sans-serif"><b>Envio em MODO DE TESTE.</b><br>` +
            `Destinatários reais seriam: ${reais}</div>`
        : `${m.corpo}\n\n---\nEnvio em MODO DE TESTE.\nDestinatários reais seriam: ${reais}`;
}
export function montarMensagemDoGrafo(m: Mensagem, testePara?: string): MensagemDoGrafo {
    const emTeste = Boolean(testePara);
    const destinatariosReais = [...m.para, ...(m.cc ?? [])].join(', ');
    const corpo = corpoComAvisoDeTeste(m, testePara);
    return {
        message: {
            subject: emTeste ? `[TESTE] ${m.assunto}` : m.assunto,
            body: { contentType: m.html ? 'HTML' : 'Text', content: corpo },
            toRecipients: (emTeste ? [testePara!] : m.para).map((e) => ({
                emailAddress: { address: e },
            })),
            ccRecipients: (emTeste ? [] : (m.cc ?? [])).map((e) => ({ emailAddress: { address: e } })),
            attachments: (m.anexos ?? []).map((a) => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: a.nome,
                contentType: a.tipo ?? 'application/octet-stream',
                contentBytes: Buffer.from(a.conteudo).toString('base64'),
                ...(a.idEmbutido ? { isInline: true, contentId: a.idEmbutido } : {}),
            })),
        },
        saveToSentItems: true,
    };
}
export async function anexosDeCaminhos(caminhos: string[] | string): Promise<Anexo[]> {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const lista = (Array.isArray(caminhos) ? caminhos : String(caminhos).split(/[;\n]/))
        .map((c) => c.trim())
        .filter(Boolean);
    return Promise.all(lista.map(async (caminho) => ({
        nome: basename(caminho),
        conteudo: new Uint8Array(await readFile(caminho)),
    })));
}
export type CaixaDeEmail = {
    tipo: 'graph';
    caixa: string;
    pasta?: string;
    token: string;
} | {
    tipo: 'imap';
    caixa: string;
    pasta?: string;
    cliente: ClienteImap;
};
export interface ClienteImap {
    connect(): Promise<void>;
    mailboxOpen(pasta: string): Promise<unknown>;
    fetch(intervalo: unknown, campos: unknown): AsyncIterable<unknown>;
    logout(): Promise<void>;
}
export interface ConfigImap {
    servidor: string;
    porta: number;
    seguro: boolean;
    usuario: string;
    senha: string;
    pasta?: string;
}
export interface MensagemLida {
    id: string;
    campos: Record<string, string>;
    temAnexo: boolean;
}
export async function abrirCaixa(caixa: string, cofre: AcessoAoCofre, pasta?: string): Promise<CaixaDeEmail> {
    const falta = ['EMAIL_TENANT_ID', 'EMAIL_CLIENT_ID'].filter((v) => !process.env[v]);
    if (falta.length) {
        throw new Error(`Faltam variáveis para leitura de e-mail: ${falta.join(', ')}`);
    }
    const cred = await cofre.ler(process.env.EMAIL_CREDENCIAL ?? 'CRD_EMAIL');
    const segredo = cred.ClientSecret ?? cred.Password ?? cred.senha;
    if (!segredo) {
        throw new Error(`A credencial do aplicativo não tem o segredo. Encontrados: ${Object.keys(cred).join(', ')}. ` +
            'Esperado: ClientSecret.');
    }
    const token = await obterToken({
        tenantId: process.env.EMAIL_TENANT_ID!,
        clientId: process.env.EMAIL_CLIENT_ID!,
        clientSecret: segredo,
        remetente: caixa,
    });
    return pasta === undefined
        ? { tipo: 'graph', caixa, token }
        : { tipo: 'graph', caixa, pasta, token };
}
export async function mensagens(c: CaixaDeEmail): Promise<MensagemLida[]> {
    if (c.tipo === 'imap')
        return mensagensPorImap(c.cliente);
    return mensagensPorGrafo(c);
}
async function mensagensPorImap(cliente: ClienteImap): Promise<MensagemLida[]> {
    const lidas: MensagemLida[] = [];
    for await (const bruta of cliente.fetch('1:*', { envelope: true, bodyStructure: true, source: true })) {
        const m = bruta as {
            uid?: number;
            envelope?: {
                subject?: string;
                from?: Array<{
                    address?: string;
                }>;
                to?: Array<{
                    address?: string;
                }>;
                date?: Date | string;
            };
            bodyStructure?: {
                childNodes?: Array<{
                    disposition?: string;
                }>;
            };
            source?: Buffer;
        };
        const env = m.envelope ?? {};
        const temAnexo = (m.bodyStructure?.childNodes ?? []).some((p) => /attachment/i.test(p.disposition ?? ''));
        lidas.push({
            id: String(m.uid ?? ''),
            temAnexo,
            campos: {
                emailSubject: env.subject ?? '',
                emailFrom: env.from?.[0]?.address ?? '',
                emailTo: (env.to ?? [])
                    .map((t) => t.address ?? '')
                    .filter(Boolean)
                    .join('; '),
                emailDate: env.date instanceof Date ? env.date.toISOString() : String(env.date ?? ''),
                emailBody: m.source?.toString('utf8') ?? '',
            },
        });
    }
    return lidas;
}
async function mensagensPorGrafo(c: Extract<CaixaDeEmail, {
    tipo: 'graph';
}>): Promise<MensagemLida[]> {
    const onde = c.pasta
        ? `${GRAFO}/users/${encodeURIComponent(c.caixa)}/mailFolders/${c.pasta}/messages`
        : `${GRAFO}/users/${encodeURIComponent(c.caixa)}/messages`;
    const r = await fetch(onde, { headers: { Authorization: `Bearer ${c.token}` } });
    if (r.status === 403 || r.status === 401) {
        throw new Error(`O Graph recusou a leitura da caixa ${c.caixa} (HTTP ${r.status}). ` +
            'O aplicativo tem permissão de envio, e ler exige a permissão de aplicativo ' +
            '`Mail.Read` concedida no tenant — pedido para a Segurança da Informação, ' +
            'não configuração deste robô.');
    }
    if (!r.ok) {
        throw new Error(`O Graph recusou a leitura da caixa ${c.caixa} (HTTP ${r.status}).`);
    }
    const { value } = (await r.json()) as {
        value?: Array<{
            id?: string;
            subject?: string;
            from?: {
                emailAddress?: {
                    address?: string;
                };
            };
            toRecipients?: Array<{
                emailAddress?: {
                    address?: string;
                };
            }>;
            receivedDateTime?: string;
            body?: {
                content?: string;
            };
            hasAttachments?: boolean;
        }>;
    };
    return (value ?? []).map((m) => ({
        id: m.id ?? '',
        temAnexo: m.hasAttachments === true,
        campos: {
            emailSubject: m.subject ?? '',
            emailFrom: m.from?.emailAddress?.address ?? '',
            emailTo: (m.toRecipients ?? [])
                .map((t) => t.emailAddress?.address ?? '')
                .filter(Boolean)
                .join('; '),
            emailDate: m.receivedDateTime ?? '',
            emailBody: m.body?.content ?? '',
        },
    }));
}
export async function fecharCaixa(c: CaixaDeEmail): Promise<void> {
    if (c.tipo === 'imap')
        await c.cliente.logout();
}
export async function abrirCaixaImap(cfg: ConfigImap, criarCliente: (cfg: ConfigImap) => ClienteImap = clienteImapPadrao): Promise<CaixaDeEmail> {
    const cliente = criarCliente(cfg);
    await cliente.connect();
    const pasta = cfg.pasta?.trim() || 'INBOX';
    await cliente.mailboxOpen(pasta);
    return { tipo: 'imap', caixa: cfg.usuario, pasta, cliente };
}
function clienteImapPadrao(cfg: ConfigImap): ClienteImap {
    const { ImapFlow } = require('imapflow') as {
        ImapFlow: new (o: unknown) => ClienteImap;
    };
    return new ImapFlow({
        host: cfg.servidor,
        port: cfg.porta,
        secure: cfg.seguro,
        auth: { user: cfg.usuario, pass: cfg.senha },
        logger: false,
    });
}
export interface ConfigEmail {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    remetente: string;
    testePara?: string | undefined;
}
async function obterToken(c: ConfigEmail): Promise<string> {
    const corpo = new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });
    const r = await fetch(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpo,
    });
    if (!r.ok) {
        const erro = (await r.json().catch(() => ({}))) as {
            error?: string;
            error_description?: string;
        };
        throw new Error(`Azure recusou o token (HTTP ${r.status}): ${erro.error ?? '?'} — ` +
            `${(erro.error_description ?? '').split('\n')[0]}`);
    }
    const { access_token } = (await r.json()) as {
        access_token: string;
    };
    return access_token;
}
async function enviarPorSmtp(c: ConfigSmtp, m: Mensagem, emTeste: boolean): Promise<void> {
    const { createTransport } = await import('nodemailer');
    const transporte = createTransport({
        host: c.host,
        port: c.porta,
        secure: false,
        requireTLS: true,
        auth: { user: c.usuario, pass: c.senha },
    });
    await transporte.sendMail(mensagemParaSmtp(c, m, emTeste));
}
export function destinatariosDoLog(m: Pick<Mensagem, 'para' | 'cc'>, testePara: string | undefined): {
    para: string;
    cc: string;
    modoTeste: boolean;
} {
    const desvio = testePara || undefined;
    return {
        para: desvio ?? m.para.join(', '),
        cc: desvio ? '' : (m.cc ?? []).join(', '),
        modoTeste: Boolean(desvio),
    };
}
export interface MensagemDoSmtp {
    from: string;
    to: string;
    cc?: string | undefined;
    subject: string;
    text: string;
    html?: string | undefined;
    attachments?: Array<{
        filename: string;
        content: Buffer;
        contentType?: string | undefined;
        cid?: string | undefined;
        contentDisposition?: 'inline' | undefined;
    }>;
}
export function mensagemParaSmtp(c: ConfigSmtp, m: Mensagem, emTeste: boolean): MensagemDoSmtp {
    const corpo = corpoComAvisoDeTeste(m, emTeste ? c.testePara : undefined);
    return {
        from: c.remetente,
        to: (emTeste ? [c.testePara!] : m.para).join(', '),
        cc: emTeste ? undefined : m.cc?.join(', '),
        subject: emTeste ? `[TESTE] ${m.assunto}` : m.assunto,
        text: corpo,
        ...(m.html ? { html: corpo } : {}),
        attachments: (m.anexos ?? []).map((a) => ({
            filename: a.nome,
            content: Buffer.from(a.conteudo),
            contentType: a.tipo,
            ...(a.idEmbutido ? { cid: a.idEmbutido, contentDisposition: 'inline' as const } : {}),
        })),
    };
}
export interface ConfigSmtp {
    host: string;
    porta: number;
    usuario: string;
    senha: string;
    remetente: string;
    testePara?: string | undefined;
}
export async function enviar(c: ConfigEmail, m: Mensagem): Promise<void> {
    const token = await obterToken(c);
    const emTeste = Boolean(c.testePara);
    const para = emTeste ? [c.testePara!] : m.para;
    const cc = emTeste ? [] : (m.cc ?? []);
    const mensagem = montarMensagemDoGrafo(m, c.testePara);
    const r = await fetch(`${GRAFO}/users/${encodeURIComponent(c.remetente)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(mensagem),
    });
    if (!r.ok) {
        const txt = (await r.text()).slice(0, 300);
        throw new Error(`Graph recusou o envio (HTTP ${r.status}): ${txt}`);
    }
    registrar('info', 'e-mail enviado', {
        de: c.remetente,
        para: para.join(', '),
        cc: cc.join(', '),
        assunto: mensagem.message.subject,
        anexos: m.anexos?.length ?? 0,
        modoTeste: emTeste,
    });
}
export async function configDoAmbiente(lerSegredo: (caminho: string) => Promise<Record<string, string>>): Promise<ConfigEmail> {
    const caminho = process.env.EMAIL_CREDENCIAL ?? 'CRD_EMAIL';
    const cred = await lerSegredo(caminho);
    const segredo = cred.ClientSecret ?? cred.Password ?? cred.senha;
    const daCredencial = (...nomes: string[]): string | undefined => campoDa(cred, ...nomes);
    const { tenantId, clientId } = identidadeDoAplicativo(cred, caminho);
    const remetente = daCredencial('Remetente', 'REMETENTE', 'remetente', 'From') ?? process.env.EMAIL_REMETENTE;
    const falta = [!remetente && 'Remetente', !segredo && 'ClientSecret'].filter(Boolean);
    if (falta.length) {
        throw new Error(`A credencial "${caminho}" não traz ${falta.join(', ')}, e o ambiente também não. ` +
            `Campos encontrados na vaga: ${Object.keys(cred).join(', ') || '(nenhum)'}.`);
    }
    return {
        tenantId: tenantId!,
        clientId: clientId!,
        clientSecret: segredo!,
        remetente: remetente!,
        testePara: process.env.EMAIL_TESTE_PARA,
    };
}
const CAMPO_CODE_DO_GRAFO = /"code"\s*:\s*"([^"]*)"/;
function codigoDoErroDoGrafo(corpo: string): string | undefined {
    try {
        const j = JSON.parse(corpo) as {
            error?: {
                code?: string;
                innerError?: {
                    code?: string;
                };
            };
        };
        const codigo = j.error?.code ?? j.error?.innerError?.code;
        if (codigo)
            return codigo;
    }
    catch {
    }
    return CAMPO_CODE_DO_GRAFO.exec(corpo)?.[1];
}
const SEPARADOR_DO_CODIGO = ' — ';
export function recusaDoGrafo(status: number, corpo: string): string {
    const codigo = codigoDoErroDoGrafo(corpo);
    const trecho = corpo.slice(0, 300);
    const resumo = codigo ? `${codigo}${SEPARADOR_DO_CODIGO}${trecho}` : trecho;
    return `Graph recusou o envio (HTTP ${status}): ${resumo}`;
}
const RECUSA_COM_CODIGO = /^Graph recusou o envio \(HTTP \d+\): ([A-Za-z][A-Za-z0-9_.-]*) — /;
export function codigoDaRecusaDoGrafo(mensagem: string): string | undefined {
    return RECUSA_COM_CODIGO.exec(mensagem)?.[1];
}
async function enviarPorGraphDelegado(m: Mensagem, ler: (c: string) => Promise<Record<string, string>>, gravar: (c: string, d: Record<string, string>) => Promise<void>, nomeCred: string, acessoDoPainel?: (credencial: string, vaga?: string) => Promise<string>, vagaDoToken?: string): Promise<void> {
    const acesso = acessoDoPainel
        ? await acessoDoPainel(nomeCred, vagaDoToken)
        : await renovarAcessoDeEmail({ ler, guardar: gravar }, nomeCred, vagaDoToken);
    const emTeste = Boolean(process.env.EMAIL_TESTE_PARA);
    const para = emTeste ? [process.env.EMAIL_TESTE_PARA!] : m.para;
    const cc = emTeste ? [] : (m.cc ?? []);
    const caixa = caixaDeEnvio(await ler(nomeCred).catch(() => ({}) as Record<string, string>));
    const rota = caixa ? `/users/${encodeURIComponent(caixa)}/sendMail` : '/me/sendMail';
    const envio = await fetch(`${GRAFO}${rota}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${acesso}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(montarMensagemDoGrafo(m, process.env.EMAIL_TESTE_PARA)),
    });
    if (!envio.ok) {
        throw new Error(recusaDoGrafo(envio.status, await envio.text()));
    }
    registrar('info', 'e-mail enviado', {
        via: 'graph-delegado',
        de: 'a conta que autorizou (/me)',
        para: para.join(', '),
        cc: cc.join(', '),
        anexos: m.anexos?.length ?? 0,
        modoTeste: emTeste,
    });
}
export interface AcessoAoCofre {
    ler(caminho: string): Promise<Record<string, string>>;
    guardar(caminho: string, dados: Record<string, string>): Promise<void>;
    acessoDeEmail?(credencial: string, vaga?: string): Promise<string>;
    enviarPelaFerramenta?(m: Mensagem): Promise<'smtp'>;
}
const AUTORIZACAO = 'ENVIO_EXTERNO_AUTORIZADO_POR';
function conferirAutorizacao(m: Mensagem, caixaDeQuemAutorizou?: string): void {
    if (process.env.EMAIL_TESTE_PARA)
        return;
    const caixa = caixaDeQuemAutorizou?.trim().toLowerCase();
    if (caixa) {
        const destinos = [...m.para, ...(m.cc ?? [])];
        const soParaEla = destinos.length > 0 && destinos.every((d) => d.trim().toLowerCase() === caixa);
        if (soParaEla) {
            registrar('info', 'envio para a propria caixa de quem autorizou', {
                assunto: m.assunto,
            });
            return;
        }
    }
    const quem = process.env[AUTORIZACAO]?.trim();
    if (!quem) {
        const destinos = [...m.para, ...(m.cc ?? [])].join(', ');
        throw new Error('ENVIO BLOQUEADO — a plataforma está em laboratório e não tem autorização da SI ' +
            'para escrever para fora. ' +
            `Sairia para: ${destinos}. ` +
            `Defina EMAIL_TESTE_PARA para desviar tudo a uma caixa de teste, ou ${AUTORIZACAO} ` +
            'com o nome de quem autorizou, quando houver autorização.');
    }
    registrar('aviso', 'ENVIO A DESTINATÁRIOS REAIS', {
        autorizadoPor: quem,
        para: m.para.join(', '),
        cc: (m.cc ?? []).join(', '),
        assunto: m.assunto,
    });
}
export async function avisarDonoDaAutorizacaoVencida(cofre: AcessoAoCofre, vagaDoToken: string | undefined, agora: () => Date = () => new Date()): Promise<'avisado' | 'ja-avisado' | 'sem-conta' | 'sem-vaga' | 'falhou'> {
    if (!vagaDoToken)
        return 'sem-vaga';
    try {
        const vaga = await cofre.ler(vagaDoToken);
        const conta = vaga.ContaMicrosoft?.trim();
        if (!conta)
            return 'sem-conta';
        const avisadoEm = vaga.AvisadoEm?.trim();
        const autorizadoEm = vaga.AutorizadoEm?.trim();
        if (avisadoEm && (!autorizadoEm || avisadoEm >= autorizadoEm))
            return 'ja-avisado';
        const quando = autorizadoEm
            ? new Date(autorizadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
            : '(data não registrada)';
        const remetente = caixaDaFerramenta()?.remetente ?? 'a caixa da ferramenta';
        await despachar({
            para: [conta],
            cc: destinatariosDoAviso(),
            assunto: '[Self Automate] o seu relatório saiu por outra caixa — a autorização venceu',
            corpo: [
                'O relatório foi ENVIADO normalmente. Nada ficou parado, e não é preciso',
                'fazer nada com urgência.',
                '',
                `O que mudou: ele saiu de ${remetente}, e não do seu endereço.`,
                '',
                'Motivo: a autorização que você deu ao Self Automate para enviar em seu',
                'nome deixou de poder ser renovada. A Azure recusou com `invalid_grant`,',
                'que costuma ser a política de multifator da empresa expirando. Nada foi',
                'removido: é um prazo que venceu.',
                ``,
                `Você autorizou em ${quando}.`,
                '',
                'Para o relatório voltar a sair do SEU endereço:',
                '  Self Automate → Automação → Painéis por e-mail → "Autorizar meu e-mail".',
                'Leva um minuto, e é preciso passar pela multifator na hora.',
                '',
                'Enquanto isso não acontecer, o relatório CONTINUA saindo por esta caixa.',
                'Ele não para.',
            ].join('\n'),
        }, cofre, undefined, undefined, undefined, 'ferramenta');
        await cofre.guardar(vagaDoToken, { ...vaga, AvisadoEm: agora().toISOString() });
        registrar('info', 'dono avisado de que a autorizacao da vaga venceu', {
            vaga: vagaDoToken,
            conta,
        });
        return 'avisado';
    }
    catch (erro) {
        registrar('erro', 'nao foi possivel avisar o dono da vaga vencida', {
            vaga: vagaDoToken,
            motivo: erro instanceof Error ? erro.message : String(erro),
        });
        return 'falhou';
    }
}
function destinatariosDoAviso(): string[] {
    return (process.env.ALERTA_PARA ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
}
export async function despachar(m: Mensagem, cofre: AcessoAoCofre, caminhoNoCofre?: string, vagaDoToken?: string, caixaDeQuemAutorizou?: string, caixa?: 'ferramenta'): Promise<'smtp' | 'graph'> {
    conferirAutorizacao(m, caixaDeQuemAutorizou);
    if (caixa === 'ferramenta') {
        return await enviarPelaCaixaDaFerramenta(m, cofre);
    }
    const lerSegredo = (c: string) => cofre.ler(c);
    const host = process.env.EMAIL_SMTP_HOST;
    const nomeCred = caminhoNoCofre ?? process.env.EMAIL_CREDENCIAL ?? 'CRD_EMAIL';
    const caixaEscolhida = vagaDoToken !== undefined;
    if (host && !caixaEscolhida) {
        const cred = await lerSegredo(nomeCred);
        const usuario = cred.UserName ?? cred.usuario ?? cred.Email;
        const senha = cred.Password ?? cred.senha;
        if (!usuario || !senha) {
            throw new Error(`CRD_EMAIL não tem os atributos para SMTP. Encontrados: ${Object.keys(cred).join(', ')}. ` +
                'Esperado: UserName e Password.');
        }
        const testePara = process.env.EMAIL_TESTE_PARA;
        await enviarPorSmtp({
            host,
            porta: Number(process.env.EMAIL_SMTP_PORTA ?? 587),
            usuario,
            senha,
            remetente: process.env.EMAIL_REMETENTE ?? usuario,
            testePara,
        }, m, Boolean(testePara));
        registrar('info', 'e-mail enviado', {
            via: 'smtp',
            host,
            de: process.env.EMAIL_REMETENTE ?? usuario,
            ...destinatariosDoLog(m, testePara),
        });
        return 'smtp';
    }
    const acessoDoPainel = cofre.acessoDeEmail
        ? (credencial: string, vaga?: string) => cofre.acessoDeEmail!(credencial, vaga)
        : undefined;
    try {
        await enviarPorGraphDelegado(m, lerSegredo, (c, d) => cofre.guardar(c, d), nomeCred, acessoDoPainel, vagaDoToken);
    }
    catch (erro) {
        const podeRecuar = ehNaoAutorizado(erro) || ehAutorizacaoVencida(erro);
        const recuo = cofre.enviarPelaFerramenta
            ? () => cofre.enviarPelaFerramenta!(m)
            : caixaDaFerramenta()
                ? () => enviarPelaCaixaDaFerramenta(m, cofre)
                : undefined;
        if (!podeRecuar || !recuo)
            throw erro;
        registrar('info', ehNaoAutorizado(erro)
            ? 'ninguem autorizou esta vaga; recuando para a caixa da ferramenta'
            : 'a autorizacao desta vaga venceu; recuando para a caixa da ferramenta', { vaga: vagaDoToken ?? '(padrao)' });
        const via = await recuo();
        if (ehAutorizacaoVencida(erro))
            await avisarDonoDaAutorizacaoVencida(cofre, vagaDoToken);
        return via;
    }
    return 'graph';
}
export interface CaixaDaFerramenta {
    host: string;
    porta: number;
    remetente: string;
    credencial: string;
}
export function caixaDaFerramenta(): CaixaDaFerramenta | undefined {
    const host = process.env.EMAIL_FERRAMENTA_SMTP_HOST?.trim();
    const remetente = process.env.EMAIL_FERRAMENTA_REMETENTE?.trim();
    if (!host || !remetente)
        return undefined;
    return {
        host,
        porta: Number(process.env.EMAIL_FERRAMENTA_SMTP_PORTA ?? 587),
        remetente,
        credencial: process.env.EMAIL_FERRAMENTA_CREDENCIAL?.trim() || 'CRD_EMAIL_FERRAMENTA',
    };
}
export async function enviarPelaCaixaDaFerramenta(m: Mensagem, cofre: Pick<AcessoAoCofre, 'ler'>, enviar: (c: ConfigSmtp, m: Mensagem, emTeste: boolean) => Promise<void> = enviarPorSmtp): Promise<'smtp'> {
    const caixa = caixaDaFerramenta();
    if (!caixa) {
        throw new Error('A caixa da ferramenta nao esta configurada. Defina EMAIL_FERRAMENTA_SMTP_HOST e ' +
            'EMAIL_FERRAMENTA_REMETENTE no ambiente, e guarde UserName/Password em ' +
            `"${process.env.EMAIL_FERRAMENTA_CREDENCIAL?.trim() || 'CRD_EMAIL_FERRAMENTA'}" no cofre.`);
    }
    const cred = await cofre.ler(caixa.credencial);
    const usuario = cred.UserName ?? cred.usuario ?? cred.Email;
    const senha = cred.Password ?? cred.senha;
    if (!usuario || !senha) {
        throw new Error(`A credencial "${caixa.credencial}" nao tem os atributos para SMTP. ` +
            `Encontrados: ${Object.keys(cred).join(', ') || '(nenhum)'}. Esperado: UserName e Password.`);
    }
    const testePara = process.env.EMAIL_TESTE_PARA;
    await enviar({ host: caixa.host, porta: caixa.porta, usuario, senha, remetente: caixa.remetente, testePara }, m, Boolean(testePara));
    registrar('info', 'e-mail enviado', {
        via: 'smtp',
        caixa: 'ferramenta',
        host: caixa.host,
        de: caixa.remetente,
        ...destinatariosDoLog(m, testePara),
    });
    return 'smtp';
}
