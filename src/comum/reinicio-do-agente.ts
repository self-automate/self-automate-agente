import { comandoDeListarProcessos } from './instancia-unica.js';
export const NOME_DA_TAREFA = 'SelfAutomate-Agente';
export const comandoDeGarantirTarefa = (executavel: string): string => `schtasks /Create /TN ${NOME_DA_TAREFA} /TR '"${executavel}"' /SC ONLOGON /RL LIMITED /F`;
export const comandoDeConferirTarefa = (): string => `schtasks /Query /TN ${NOME_DA_TAREFA}`;
export const ARQUIVO_DE_RASTRO = 'bot-agente-reinicio.txt';
export const ARQUIVO_DE_LOG = 'agente.log';
export function scriptDeReinicio(pid: number, executavel: string, robosRodando: string[] = []): string {
    const pasta = executavel.replace(/[^\\/]+$/, '');
    const rastro = pasta + ARQUIVO_DE_RASTRO;
    const logDoAgente = pasta + ARQUIVO_DE_LOG;
    const aCorrer = robosRodando
        .map((n) => n.replace(/[^A-Za-z0-9_.-]/g, ''))
        .filter((n) => n.length > 0)
        .join(',') || 'nenhum';
    const diz = (texto: string) => `diz "${texto}"`;
    const definicoes = `function diz($t) { Add-Content -LiteralPath '${rastro}' -Value ("[" + (Get-Date -Format 'HH:mm:ss') + "] " + $t) }; ` +
        `function vivos { @(${comandoDeListarProcessos()} | ConvertFrom-Json).Count }; ` +
        `function motivo{$e=Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational';Id=101,104;StartTime=(Get-Date).AddMinutes(-2)} -MaxEvents 1 -EA 0;` +
        `if($e.Message -match '(\\d{9,})'){diz ("agendador: "+([ComponentModel.Win32Exception]([int]([int64]$matches[1] -band 0xFFFF))).Message)}` +
        `else{diz 'agendador: nenhum 101/104'}}`;
    const lancarDireto = `Start-Process -FilePath cmd.exe -WindowStyle Hidden ` +
        `-ArgumentList '/c', '""${executavel}" >> "${logDoAgente}" 2>&1"'`;
    return [
        definicoes,
        diz(`cadeia iniciada; alvo pid ${pid}; a correr: ${aCorrer}`),
        'Start-Sleep -Seconds 5',
        '$vivosAntes = vivos',
        diz('agentes vivos antes do kill: $vivosAntes'),
        `Stop-Process -Id ${pid} -Force -ErrorAction Continue -ErrorVariable erroDeMorte`,
        `if ($erroDeMorte) { ${diz('Stop-Process reclamou: $($erroDeMorte[0].Exception.Message)')} } ` +
            `else { ${diz('Stop-Process nao reclamou')} }`,
        `Wait-Process -Id ${pid} -Timeout 20 -ErrorAction SilentlyContinue`,
        `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { ${diz('ANTECESSOR AINDA VIVO apos 20s')} } ` +
            `else { ${diz('antecessor encerrado')} }`,
        '$vivosDepois = vivos',
        diz('agentes vivos depois do kill: $vivosDepois (antes: $vivosAntes)'),
        'if ($vivosDepois -gt 0) { ' +
            diz('ATENCAO: sobrou agente que esta cadeia NAO mirou') +
            ' }',
        `$env:SELF_AUTOMATE_ANTECESSOR = '${pid}'`,
        `$consultaDaTarefa = (schtasks /Query /TN ${NOME_DA_TAREFA} 2>&1 | Out-String)`,
        `$tarefaExiste = ($LASTEXITCODE -eq 0) -and ($consultaDaTarefa -match '${NOME_DA_TAREFA}')`,
        diz('tarefa agendada existe: $tarefaExiste'),
        'if ($tarefaExiste) { ' +
            diz('subindo pela TAREFA') +
            '; ' +
            `$saidaDaTarefa = (schtasks /Run /TN ${NOME_DA_TAREFA} 2>&1 | Out-String).Trim()` +
            '; ' +
            diz('schtasks /Run respondeu: $saidaDaTarefa') +
            ' } else { ' +
            diz('tarefa ausente; subindo por Start-Process') +
            '; ' +
            lancarDireto +
            '; ' +
            diz('Start-Process disparado') +
            ' }',
        'Start-Sleep -Seconds 15',
        '$vivosDepoisDoStart = vivos',
        diz('sucessor vivo apos 15 s: $vivosDepoisDoStart'),
        'if ($vivosDepoisDoStart -eq 0) { ' +
            diz('SUCESSOR NAO SUBIU; segunda tentativa pelo OUTRO caminho') +
            '; motivo; if ($tarefaExiste) { ' +
            lancarDireto +
            '; ' +
            diz('Start-Process disparado') +
            ' } else { ' +
            `$saidaDaTarefa = (schtasks /Run /TN ${NOME_DA_TAREFA} 2>&1 | Out-String).Trim()` +
            '; ' +
            diz('schtasks /Run respondeu: $saidaDaTarefa') +
            ' }; Start-Sleep -Seconds 15; ' +
            '$vivosAposSegunda = vivos; ' +
            diz('apos a segunda tentativa: $vivosAposSegunda vivo(s)') +
            '; if ($vivosAposSegunda -eq 0) { ' +
            diz('FALHOU: nenhum agente vivo depois das duas tentativas (tarefa e Start-Process)') +
            ' }' +
            ' }',
    ].join('; ');
}
export function comandoDeReiniciar(pid: number, executavel: string, robosRodando: string[] = []): string {
    const codificado = Buffer.from(scriptDeReinicio(pid, executavel, robosRodando), 'utf16le').toString('base64');
    return (`Start-Process -FilePath powershell -WindowStyle Hidden ` +
        `-ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${codificado}'`);
}
export function aTarefaExiste(saidaDoQuery: string): boolean {
    const t = saidaDoQuery.trim();
    if (!t)
        return false;
    if (/\bERRO\b|\bERROR\b|n[ãa]o (pode |consegue )?encontr|cannot find|does not exist|n[ãa]o existe/i.test(t)) {
        return false;
    }
    return t.includes(NOME_DA_TAREFA);
}
export function decidirRegistroDaTarefa(saidaDoQuery: string): {
    criar: boolean;
    motivo: string;
} {
    if (aTarefaExiste(saidaDoQuery)) {
        return {
            criar: false,
            motivo: `tarefa \`${NOME_DA_TAREFA}\` já existe — a configuração do operador foi respeitada`,
        };
    }
    return { criar: true, motivo: `tarefa \`${NOME_DA_TAREFA}\` ausente — criada` };
}
export interface EstadoDaTroca {
    trocou: boolean;
    executavelNoLugar: boolean;
}
export function decidirReinicio(estado: EstadoDaTroca): {
    reiniciar: boolean;
    motivo: string;
} {
    if (!estado.trocou) {
        return {
            reiniciar: false,
            motivo: 'nada foi trocado, então não há versão nova para promover — reiniciar seria risco sem ganho.',
        };
    }
    if (!estado.executavelNoLugar) {
        return {
            reiniciar: false,
            motivo: 'o binário novo foi gravado, mas o executável NÃO foi encontrado no caminho canônico — ' +
                'sem caminho de volta conferido em disco, encerrar deixaria esta máquina sem agente, e ' +
                'ela só se alcança presencialmente. O agente segue na versão antiga, de propósito.',
        };
    }
    return {
        reiniciar: true,
        motivo: 'executável conferido no caminho canônico: o caminho de volta existe. O agente vai ' +
            'encerrar e subir de novo em cerca de 5 segundos, já na versão nova.',
    };
}
export const SILENCIO_ATE_REINICIAR_MS = 11 * 60000;
const tempoLegivel = (ms: number): string => {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
};
export function decidirReinicioPorSilencio(e: {
    falhasSeguidas: number;
    msDeSilencio: number;
    limiteMs: number;
}): {
    reiniciar: boolean;
    motivo: string;
} {
    if (!Number.isFinite(e.limiteMs) || e.limiteMs <= 0) {
        return { reiniciar: false, motivo: `limite invalido (${e.limiteMs}) — nao reinicio por omissao` };
    }
    if (e.falhasSeguidas <= 0) {
        return { reiniciar: false, motivo: 'nenhuma falha seguida — sem silencio a medir' };
    }
    const silencio = Number.isFinite(e.msDeSilencio) && e.msDeSilencio > 0 ? e.msDeSilencio : 0;
    const quadro = `${e.falhasSeguidas} falhas seguidas, ${tempoLegivel(silencio)} sem anunciar ` +
        `(reinicio aos ${tempoLegivel(e.limiteMs)})`;
    if (e.falhasSeguidas < 2 || silencio < e.limiteMs) {
        return { reiniciar: false, motivo: `${quadro} — ainda a acumular` };
    }
    return { reiniciar: true, motivo: `${quadro} — reiniciando` };
}
export interface EstadoDoBatimento {
    falhasSeguidas: number;
    ultimoSucessoEm: number;
    restabelecido: boolean;
    decisao: ReturnType<typeof decidirReinicioPorSilencio>;
}
export async function acompanharBatimento(bater: () => Promise<boolean>, estado: {
    falhasSeguidas: number;
    ultimoSucessoEm: number;
    limiteMs: number;
    agora?: () => number;
}): Promise<EstadoDoBatimento> {
    const agora = estado.agora ?? Date.now;
    let bateu: boolean;
    try {
        bateu = (await bater()) === true;
    }
    catch {
        bateu = false;
    }
    if (bateu) {
        return {
            falhasSeguidas: 0,
            ultimoSucessoEm: agora(),
            restabelecido: estado.falhasSeguidas > 0,
            decisao: decidirReinicioPorSilencio({ falhasSeguidas: 0, msDeSilencio: 0, limiteMs: estado.limiteMs }),
        };
    }
    const falhasSeguidas = estado.falhasSeguidas + 1;
    return {
        falhasSeguidas,
        ultimoSucessoEm: estado.ultimoSucessoEm,
        restabelecido: false,
        decisao: decidirReinicioPorSilencio({
            falhasSeguidas,
            msDeSilencio: agora() - estado.ultimoSucessoEm,
            limiteMs: estado.limiteMs,
        }),
    };
}
