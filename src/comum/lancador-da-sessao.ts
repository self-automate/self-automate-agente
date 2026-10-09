import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { powershell } from '../blocos/powershell.js';
import type { FilhoLancado } from './processo-do-robo.js';
export const CODIGO_SEM_SESSAO = 3;
export const CODIGO_TAREFA_NAO_RODOU = 4;
export const CODIGO_SESSAO_NAO_ABRIU = 5;
export interface SessaoAberta {
    sessao: number;
    fechar(): Promise<void>;
}
export type AbridorDeSessao = (p: {
    conta: string;
}) => Promise<SessaoAberta>;
const NUNCA_RODOU = 267011;
const aspas = (s: string) => `'${s.replace(/'/g, "''")}'`;
export function scriptDaSessaoDaConta(): string {
    return [
        `$minhas = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object { $dono = Invoke-CimMethod -InputObject $_ -MethodName GetOwner; $dono.ReturnValue -eq 0 -and $dono.User -eq $env:USERNAME -and $dono.Domain -eq $env:USERDOMAIN })`,
        `if ($minhas.Count -eq 0) { 'SEM SESSAO' } else { 'SESSAO=' + $minhas[0].SessionId }`,
    ].join('\r\n');
}
export function lerSessaoDaConta(saida: string): number | undefined {
    const m = /SESSAO=(\d+)/.exec(saida);
    return m ? Number(m[1]) : undefined;
}
export function diferencaDeAmbiente(base: NodeJS.ProcessEnv, env: NodeJS.ProcessEnv): {
    definir: Record<string, string>;
    remover: string[];
} {
    const definir: Record<string, string> = {};
    for (const [k, v] of Object.entries(env))
        if (v !== undefined && base[k] !== v)
            definir[k] = v;
    const remover = Object.keys(base).filter((k) => base[k] !== undefined && env[k] === undefined);
    return { definir, remover };
}
export const arquivoDoAmbiente = (pasta: string, id: string): string => `${pasta}\\ambiente-${id}.json`;
export function aplicarAmbienteDoFilho(pasta: string, id: string, env: NodeJS.ProcessEnv = process.env): void {
    const arq = arquivoDoAmbiente(pasta, id);
    if (!existsSync(arq))
        return;
    try {
        const lido = JSON.parse(readFileSync(arq, 'utf8')) as {
            definir?: Record<string, string>;
            remover?: string[];
        };
        for (const k of lido.remover ?? [])
            delete env[k];
        Object.assign(env, lido.definir ?? {});
    }
    finally {
        rmSync(arq, { force: true });
    }
}
function scriptDeLancar(p: {
    tarefa: string;
    execPath: string;
    argumentos: string[];
}): string {
    return [
        `$ErrorActionPreference = 'Stop'`,
        `$acao = New-ScheduledTaskAction -Execute ${aspas(p.execPath)} -Argument ${aspas(p.argumentos.join(' '))}`,
        `$quem = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive`,
        `$cfg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)`,
        `Register-ScheduledTask -TaskName ${aspas(p.tarefa)} -Action $acao -Principal $quem -Settings $cfg -Force | Out-Null`,
        `Start-ScheduledTask -TaskName ${aspas(p.tarefa)}`,
        `'TAREFA disparada'`,
    ].join('\r\n');
}
const scriptDoEstado = (tarefa: string): string => `$t = Get-ScheduledTask -TaskName ${aspas(tarefa)}; $i = Get-ScheduledTaskInfo -TaskName ${aspas(tarefa)}; 'ESTADO=' + $t.State + ' RESULTADO=' + $i.LastTaskResult`;
export function lerEstadoDaTarefa(saida: string): {
    estado: string;
    resultado: number;
} | undefined {
    const m = /ESTADO=(\w+) RESULTADO=(-?\d+)/.exec(saida);
    return m ? { estado: m[1]!, resultado: Number(m[2]) } : undefined;
}
const scriptDeMatar = (marca: string): string => [
    `$alvos = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${aspas(marca)}) -and $_.ProcessId -ne $PID })`,
    `foreach ($a in $alvos) { taskkill /PID $a.ProcessId /T /F | Out-Null }`,
    `'mortos=' + $alvos.Count`,
].join('\r\n');
const scriptDeRemover = (tarefa: string): string => `Unregister-ScheduledTask -TaskName ${aspas(tarefa)} -Confirm:$false -ErrorAction SilentlyContinue`;
export function lancarNaSessao(p: {
    execPath: string;
    argumentos: string[];
    marca: string;
    tarefa: string;
    conta: string;
    pasta: string;
    id: string;
    ambiente?: {
        definir: Record<string, string>;
        remover: string[];
    };
    rodar?: (script: string) => Promise<string>;
    esperar?: (ms: number) => Promise<void>;
    intervaloMs?: number;
    prazoParaComecarMs?: number;
    abrirSessao?: AbridorDeSessao;
}): FilhoLancado {
    const rodar = p.rodar ?? ((s: string) => powershell(s));
    const esperar = p.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const intervalo = p.intervaloMs ?? 2000;
    const prazoParaComecar = p.prazoParaComecarMs ?? 60000;
    const arqAmbiente = arquivoDoAmbiente(p.pasta, p.id);
    let registrou = false;
    let cancelado = false;
    let aberta: SessaoAberta | undefined;
    const terminou = (async (): Promise<{
        codigo: number | null;
        sinal: string | null;
        motivo?: string;
    }> => {
        try {
            let sessao = lerSessaoDaConta(await rodar(scriptDaSessaoDaConta()));
            if (cancelado)
                return { codigo: null, sinal: 'cancelado' };
            if (sessao === undefined && p.abrirSessao) {
                try {
                    aberta = await p.abrirSessao({ conta: p.conta });
                    if (cancelado)
                        return { codigo: null, sinal: 'cancelado' };
                }
                catch (erro) {
                    return {
                        codigo: CODIGO_SESSAO_NAO_ABRIU,
                        sinal: null,
                        motivo: `Não foi possível abrir a sessão da conta ${p.conta}: ${erro instanceof Error ? erro.message : String(erro)}`,
                    };
                }
                sessao = lerSessaoDaConta(await rodar(scriptDaSessaoDaConta()));
                if (sessao === undefined || sessao !== aberta.sessao) {
                    return {
                        codigo: CODIGO_SESSAO_NAO_ABRIU,
                        sinal: null,
                        motivo: `O abridor disse ter aberto a sessão ${aberta.sessao} da conta ${p.conta}, mas a área de trabalho dela não apareceu${sessao === undefined ? '' : `: foi encontrada a sessão ${sessao}`}.`,
                    };
                }
            }
            if (sessao === undefined) {
                return {
                    codigo: CODIGO_SEM_SESSAO,
                    sinal: null,
                    motivo: `A conta ${p.conta} não tem sessão nesta máquina — entre com ela e feche no X (sem sair), e rode de novo.`,
                };
            }
            if (p.ambiente && (Object.keys(p.ambiente.definir).length > 0 || p.ambiente.remover.length > 0)) {
                writeFileSync(arqAmbiente, JSON.stringify(p.ambiente), 'utf8');
            }
            registrou = true;
            await rodar(scriptDeLancar(p));
            if (cancelado) {
                await rodar(scriptDeMatar(p.marca)).catch(() => undefined);
                return { codigo: null, sinal: 'cancelado' };
            }
            const inicio = Date.now();
            for (;;) {
                const e = lerEstadoDaTarefa(await rodar(scriptDoEstado(p.tarefa)));
                if (e && e.estado !== 'Running') {
                    if (e.resultado !== NUNCA_RODOU)
                        return { codigo: e.resultado, sinal: null };
                    if (Date.now() - inicio >= prazoParaComecar) {
                        return {
                            codigo: CODIGO_TAREFA_NAO_RODOU,
                            sinal: null,
                            motivo: `A tarefa ${p.tarefa} não rodou na sessão ${sessao} em ${Math.round(prazoParaComecar / 1000)} s.`,
                        };
                    }
                }
                await esperar(intervalo);
            }
        }
        catch (erro) {
            return { codigo: null, sinal: `erro: ${erro instanceof Error ? erro.message : String(erro)}` };
        }
        finally {
            if (registrou)
                await rodar(scriptDeRemover(p.tarefa)).catch(() => undefined);
            rmSync(arqAmbiente, { force: true });
            if (aberta)
                await aberta.fechar().catch(() => undefined);
        }
    })();
    return {
        pid: undefined,
        terminou,
        async matar() {
            cancelado = true;
            await rodar(scriptDeMatar(p.marca)).catch(() => undefined);
            await terminou;
        },
    };
}
