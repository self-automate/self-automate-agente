import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AbridorDeSessao, SessaoAberta } from './lancador-da-sessao.js';
import { lerDoCofre } from './caminho-de-credencial.js';
import { SCRIPT_DO_CLIENTE_RDP } from './cliente-rdp-embutido.js';
import { registrar } from './log.js';
export interface CredencialWindows {
    usuario: string;
    senha: string;
}
const MOTIVOS: Record<string, string> = {
    INICIALIZACAO: 'não foi possível inicializar o componente .NET do RDP',
    CREDENCIAL: 'a credencial Windows deve conter domínio, usuário e senha',
    CONCORRENCIA: 'outro abridor está usando esta conta',
    CONSULTA_SESSAO: 'não foi possível consultar as sessões Windows; conexão recusada por segurança',
    SESSAO_EXISTENTE: 'a conta já tem sessão; nenhuma conexão RDP foi iniciada',
    AUDITORIA: 'não foi possível ler o log LocalSessionManager',
    AUDITORIA_AMBIGUA: 'mais de um logon foi observado; a origem da sessão é ambígua',
    ACTIVEX: 'não foi possível hospedar ou configurar o controle ActiveX RDP',
    CONEXAO: 'a conexão RDP não pôde ser iniciada',
    RECONEXAO: 'foi observada reconexão; a sessão não será encerrada pelo abridor',
    IDENTIDADE_ALTERADA: 'a identidade da sessão mudou; o abridor recusou continuar',
    CANCELADO: 'a abertura foi cancelada',
    PRAZO: 'a área de trabalho não ficou pronta em 60 s; conferir credencial, NLA, certificado e políticas RDP',
    AVISO_LEGAL: 'não foi possível enviar o OK do aviso legal de logon pelo controle RDP',
    PRAZO_APOS_AVISO: 'a área de trabalho não ficou pronta em 60 s, mesmo depois de enviar o OK do aviso legal; conferir 4625 da conta antes de repetir',
    LOGOFF: 'não foi possível encerrar com segurança a sessão criada pelo abridor',
};
export async function executarClienteRdp(credencial: CredencialWindows, iniciar: (script: string) => ChildProcessWithoutNullStreams = iniciarPowerShell, prazoMs = 90000): Promise<SessaoAberta> {
    const filho = iniciar(SCRIPT_DO_CLIENTE_RDP);
    let erro: string | undefined;
    let numero: number | undefined;
    let fechada = false;
    let encerrar: Promise<void> | undefined;
    let resolver!: (sessao: number) => void;
    let rejeitar!: (erro: Error) => void;
    const pronta = new Promise<number>((ok, nao) => { resolver = ok; rejeitar = nao; });
    const termino = new Promise<void>((ok) => {
        filho.once('close', (codigo) => {
            if (!fechada && !erro)
                erro = `o processo RDP terminou sem confirmar o logoff (código ${codigo ?? 'indisponível'})`;
            rejeitar(new Error(erro ?? 'o processo RDP terminou antes de abrir a sessão'));
            ok();
        });
        filho.once('error', () => {
            erro = 'não foi possível iniciar o PowerShell do cliente RDP';
            rejeitar(new Error(erro));
            ok();
        });
    });
    filho.stderr.resume();
    filho.stdin.on('error', () => { });
    const linhas = createInterface({ input: filho.stdout });
    linhas.on('line', (linha) => {
        if (linha.length > 1024)
            return;
        try {
            const m = JSON.parse(linha) as {
                tipo?: string;
                sessao?: number;
                motivo?: string;
            };
            if (m.tipo === 'pronta' && Number.isSafeInteger(m.sessao) && m.sessao! > 0) {
                numero = m.sessao!;
                resolver(numero);
            }
            if (m.tipo === 'fechada')
                fechada = true;
            if (m.tipo === 'erro') {
                erro = MOTIVOS[m.motivo ?? ''] ?? 'o cliente RDP informou falha';
                rejeitar(new Error(erro));
            }
        }
        catch { }
    });
    const fechar = (): Promise<void> => encerrar ??= (async () => {
        filho.stdin.end();
        let excedeu = false;
        const limite = setTimeout(() => { excedeu = true; filho.kill(); }, 20000);
        try {
            await termino;
            if (excedeu)
                throw new Error('o cliente RDP não confirmou a limpeza; verificar a sessão no Windows');
            if (erro)
                throw new Error(erro);
            if (!fechada)
                throw new Error('o cliente RDP não confirmou o logoff');
        }
        catch (falha) {
            if (numero !== undefined || erro === MOTIVOS.LOGOFF || excedeu) {
                registrar('aviso', 'cliente RDP não confirmou a limpeza da sessão; conferir no Windows', { sessao: numero });
            }
            throw falha;
        }
        finally {
            clearTimeout(limite);
            linhas.close();
        }
    })();
    const limite = setTimeout(() => rejeitar(new Error('o cliente RDP não respondeu no prazo de inicialização')), prazoMs);
    filho.stdin.write(Buffer.from(SCRIPT_DO_CLIENTE_RDP, 'utf8').toString('base64') + '\n');
    filho.stdin.write(JSON.stringify(credencial) + '\n');
    try {
        const sessao = await pronta;
        return { sessao, fechar };
    }
    catch (falha) {
        await fechar().catch(() => undefined);
        throw falha;
    }
    finally {
        clearTimeout(limite);
    }
}
const CARREGADOR_RDP = "$entrada = [Console]::OpenStandardInput(); $linha = New-Object Text.StringBuilder; while (($byte = $entrada.ReadByte()) -ge 0 -and $byte -ne 10) { [void]$linha.Append([char]$byte) }; & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($linha.ToString()))))";
export function montarComandoPowerShell() {
    const executavel = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const argumentos = ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(CARREGADOR_RDP, 'utf16le').toString('base64')];
    return { executavel, argumentos };
}
function iniciarPowerShell(_script: string): ChildProcessWithoutNullStreams {
    if (process.platform !== 'win32')
        throw new Error('o abridor de sessão requer Windows');
    const { executavel, argumentos } = montarComandoPowerShell();
    return spawn(executavel, argumentos, {
        windowsHide: true, stdio: 'pipe',
    });
}
export function criarAbridorDeSessao(p: {
    cofre: {
        ler(caminho: string): Promise<Record<string, string>>;
    };
    dominio: string;
    caminho?: string;
    conectar?: (credencial: CredencialWindows) => Promise<SessaoAberta>;
}): AbridorDeSessao {
    return async ({ conta }) => {
        const nome = conta.includes('\\') ? conta : `${p.dominio}\\${conta}`;
        if (!/^[^\\\r\n]+\\[^\\\r\n]+$/.test(nome))
            throw new Error('conta Windows sem domínio válido');
        const usuario = nome.split('\\')[1]!;
        const caminho = p.caminho ?? `CRD_WINDOWS_${usuario.toUpperCase()}`;
        let dados: Record<string, string>;
        try {
            dados = await p.cofre.ler(caminho);
        }
        catch {
            throw new Error(`não foi possível ler ${caminho} pelo cofre do job; conferir cadastro e permissão`);
        }
        const leitor = { ler: async () => dados };
        const login = await lerDoCofre(leitor, caminho, 'UserName');
        const senha = await lerDoCofre(leitor, caminho, 'Password');
        if (login.toLowerCase() !== nome.toLowerCase())
            throw new Error('a credencial Windows pertence a outra conta; conexão recusada');
        try {
            return await (p.conectar ?? executarClienteRdp)({ usuario: login, senha });
        }
        finally {
            dados = {};
        }
    };
}
