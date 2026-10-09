import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { writeFileSync, renameSync, existsSync, mkdirSync, rmSync, copyFileSync, unlinkSync } from 'node:fs';
import { lerConfig, lerConcorrencia, gravarConfig, caminhoDaConfig, configComTokenNovo, } from './comum/config-do-agente.js';
import { parearAgente } from './comum/parear-agente.js';
import { esperarConexao, pedirConexao } from './comum/conexao-do-agente.js';
import { spawn } from 'node:child_process';
import { iniciarLaco } from './comum/laco-do-agente.js';
import { executarCli } from './comum/cli-do-agente.js';
import { NOME_DO_ATALHO, conteudoDoAtalho, pastaDeInstalacao } from './comum/primeira-vez.js';
import { transporteHttps } from './comum/transporte-https.js';
import { lerCaminhoDoAdb, parearPeloAgente, rodarAdbPeloCaminho } from './comum/celular-do-agente.js';
import { executarJob, umTique, usaTela } from './bot-agente.js';
import { ARGUMENTO_DO_FILHO, ambienteDoFilho, lancarProcessoDoRobo } from './comum/processo-do-robo.js';
import { aplicarAmbienteDoFilho, diferencaDeAmbiente, lancarNaSessao } from './comum/lancador-da-sessao.js';
import { criarAbridorDeSessao } from './comum/abridor-de-sessao.js';
import { contaWindowsDoProcesso, sessaoDoJob } from './comum/contas-de-execucao.js';
import { registrar } from './comum/log.js';
import type { Pedido } from './comum/transporte-tipos.js';
import { executarComPrazo, prazoDoRobo } from './comum/execucao-no-filho.js';
import type { Robo } from './robo.js';
import { carregarRobosDoDisco } from './comum/robos-do-disco.js';
import { NOME_DAS_MONTAGENS, atualizarMontagensSePreciso, carregarMontagensDoDisco, robosDasMontagens } from './comum/montagens.js';
import type { MontagensAnunciadas } from './comum/montagens-publicadas.js';
import { atualizarRobosSePreciso } from './comum/atualizar-robos.js';
import { NOME_DO_PACOTE_DE_ROBOS, type ManifestoDoPacote, type DadosDaMaquina } from './comum/pacote-de-robos.js';
import { acessoDaMaquina } from './comum/acesso-da-maquina.js';
import { buscarNavegadorSePreciso, navegadorInstalado } from './comum/navegador-do-agente.js';
import { buscarPacotesSePreciso } from './comum/pacotes-do-agente.js';
import { PACOTES_DE_DISCO } from './comum/pacotes-de-disco.js';
import { CHAVES_DE_PUBLICACAO } from './comum/chave-de-publicacao.js';
import { executarAtualizacao } from './comum/atualizar-agente.js';
import { comandoDeGarantirTarefa, comandoDeConferirTarefa, comandoDeReiniciar, aTarefaExiste, decidirReinicio, NOME_DA_TAREFA, decidirRegistroDaTarefa, } from './comum/reinicio-do-agente.js';
import { powershell } from './blocos/powershell.js';
import { esperarAntecessorSair, lerProcessos, comandoDeListarProcessos, pidDeclarado, RITMO_PADRAO, } from './comum/instancia-unica.js';
import { VERSAO } from './comum/versao.js';
import { comValidade, medirAreaDeTrabalho, medirSessaoZero } from './comum/area-de-trabalho.js';
const areaDeTrabalho = comValidade(medirAreaDeTrabalho, 30000);
const sessaoZero = comValidade(medirSessaoZero, 600000);
const PASTA = dirname(process.execPath);
let robosCarregados: Robo[] | undefined;
let manifestoCarregado: ManifestoDoPacote | undefined;
let montagensCarregadas: MontagensAnunciadas | undefined;
let dadosCarregados: DadosDaMaquina | undefined;
const INTERVALO_DOS_ROBOS_MS = 5 * 60000;
const robosDoPacote = (): Robo[] => {
    if (robosCarregados)
        return robosCarregados;
    const r = carregarRobosDoDisco({ pasta: PASTA, chavePublica: CHAVES_DE_PUBLICACAO });
    if (r.ok) {
        registrar('info', 'robôs carregados do pacote', { organizacao: r.manifesto.organizacao, commit: r.manifesto.commit, robos: r.robos.length });
        robosCarregados = r.robos;
        manifestoCarregado = r.manifesto;
        montagensCarregadas = undefined;
        dadosCarregados = r.dadosDaMaquina;
        const m = carregarMontagensDoDisco({ pasta: PASTA, chavePublica: CHAVES_DE_PUBLICACAO });
        if (!m.ok)
            registrar('aviso', 'montagens recusadas', { motivo: m.motivo });
        else if (m.conjunto) {
            const s = robosDasMontagens({ conjunto: m.conjunto, organizacao: r.manifesto.organizacao, doPacote: r.robos, interpretar: r.interpretarMontagem });
            for (const motivo of s.recusas)
                registrar('aviso', 'montagem recusada', { motivo });
            registrar('info', 'robôs carregados das montagens', { versao: m.conjunto.versao, robos: s.robos.length, recusadas: s.recusas.length });
            robosCarregados = [...r.robos, ...s.robos];
            montagensCarregadas = { organizacao: m.conjunto.organizacao, versao: m.conjunto.versao, robos: s.robos.length };
        }
    }
    else {
        registrar('aviso', 'nenhum robô: o pacote de robôs não foi aceito', { motivo: r.motivo });
        robosCarregados = [];
        manifestoCarregado = undefined;
        dadosCarregados = undefined;
    }
    return robosCarregados;
};
const rodando = new Set<string>();
const filhos = new Map<string, {
    robo: string;
    pid: number | undefined;
    matar: () => Promise<void>;
}>();
const cancelando = new Set<string>();
const acesso = acessoDaMaquina(PASTA, () => VERSAO.commit, () => {
    robosDoPacote();
    return dadosCarregados;
});
function cabecalhosDoPainel(token: string): Record<string, string> {
    const portao = acessoDaBorda();
    return {
        Authorization: `Bearer ${token}`,
        ...(portao
            ? { 'CF-Access-Client-Id': portao.id, 'CF-Access-Client-Secret': portao.segredo }
            : {}),
    };
}
function comoSeAtualizar(endereco: string, token: string) {
    return (versao: string) => executarAtualizacao(versao, {
        executavelEmUso: process.execPath,
        versaoEmUso: VERSAO.commit,
        chavePublica: CHAVES_DE_PUBLICACAO,
        baixarAssinatura: async () => {
            const r = await fetch(`${endereco.replace(/\/+$/, '')}/agente/executavel.sig`, {
                headers: cabecalhosDoPainel(token),
                signal: AbortSignal.timeout(60000),
            });
            if (!r.ok)
                return undefined;
            return Buffer.from(await r.arrayBuffer());
        },
        baixar: async () => {
            const r = await fetch(`${endereco.replace(/\/+$/, '')}/agente/executavel`, {
                headers: cabecalhosDoPainel(token),
                signal: AbortSignal.timeout(15 * 60000),
            });
            if (!r.ok)
                throw new Error(`o painel recusou o download: HTTP ${r.status}`);
            return Buffer.from(await r.arrayBuffer());
        },
        gravar: async (caminho, conteudo) => {
            writeFileSync(caminho, conteudo);
        },
        renomear: async (de, para) => {
            renameSync(de, para);
        },
        promover: async () => {
            const executavelNoLugar = existsSync(process.execPath);
            const d = decidirReinicio({ trocou: true, executavelNoLugar });
            if (!d.reiniciar)
                return { reiniciou: false, motivo: d.motivo };
            let tarefa = 'tarefa agendada: nao conferida (o reinicio nao depende dela)';
            try {
                const saidaDoQuery = await powershell(comandoDeConferirTarefa()).catch(() => '');
                const registro = decidirRegistroDaTarefa(saidaDoQuery);
                if (registro.criar) {
                    await powershell(comandoDeGarantirTarefa(process.execPath));
                    if (aTarefaExiste(await powershell(comandoDeConferirTarefa())))
                        tarefa = registro.motivo;
                }
                else {
                    tarefa = registro.motivo;
                }
            }
            catch {
            }
            void powershell(comandoDeReiniciar(process.pid, process.execPath)).catch(() => undefined);
            return { reiniciou: true, motivo: `${d.motivo} ${tarefa}.` };
        },
    }).then((r) => r.mensagem);
}
let acessoDeBorda: {
    id: string;
    segredo: string;
} | undefined | null = null;
function acessoDaBorda(): {
    id: string;
    segredo: string;
} | undefined {
    if (acessoDeBorda !== null)
        return acessoDeBorda;
    const c = lerConfig(caminhoDaConfig(PASTA));
    acessoDeBorda =
        c?.acessoId && c?.acessoSegredo ? { id: c.acessoId, segredo: c.acessoSegredo } : undefined;
    return acessoDeBorda;
}
function umaVolta(endereco: string, token: string): Promise<void> {
    const guardarTokenNovo = (novo: string): void => {
        const arquivo = caminhoDaConfig(PASTA);
        gravarConfig(arquivo, configComTokenNovo(lerConfig(arquivo), endereco, novo));
    };
    const { transporte, canalDeOrdens, cofreDoJob } = transporteHttps(endereco, token, undefined, guardarTokenNovo, acessoDaBorda());
    const executarNoFilho = async (id: string, robo: Robo, pedido?: Pedido): Promise<void> => {
        const ambiente = ambienteDoFilho(process.env, pedido?.validacao);
        if (ambiente.validando !== undefined) {
            registrar('info', 'robô em validação do pedido de automação', { robo: robo.nome, pedido: ambiente.validando, job: id });
        }
        else if (ambiente.recusada) {
            registrar('aviso', 'caixa de validação recusada pelo agente — fica a caixa de teste global', { robo: robo.nome, job: id, motivo: ambiente.recusada });
        }
        const naSessao = usaTela(robo) && (await sessaoZero());
        if (naSessao)
            registrar('info', 'robô de tela vai para a sessão da conta', { robo: robo.nome, job: id });
        const sessao = sessaoDoJob(pedido?.conta, contaWindowsDoProcesso());
        if (naSessao && !sessao.ok) {
            registrar('aviso', 'job recusado: conta de execução de outro agente', { robo: robo.nome, job: id, motivo: sessao.motivo });
            await transporte.fecharExecucao(id, 'FALHOU', new Date(), `Não executado: ${sessao.motivo}.`);
            return;
        }
        await executarComPrazo({
            id,
            robo,
            prazoMin: prazoDoRobo(robo, process.env),
            lancar: () => naSessao
                ? lancarNaSessao({
                    execPath: process.execPath,
                    argumentos: [ARGUMENTO_DO_FILHO, id, robo.nome],
                    marca: `${ARGUMENTO_DO_FILHO} ${id} `,
                    tarefa: `SelfAutomate-Robo-${id}`,
                    conta: (sessao.ok && sessao.usuario) || (process.env.USERNAME ?? '(conta do agente)'),
                    pasta: PASTA,
                    id,
                    ambiente: diferencaDeAmbiente(process.env, ambiente.env),
                    abrirSessao: criarAbridorDeSessao({
                        cofre: cofreDoJob(id),
                        dominio: process.env.USERDOMAIN ?? '',
                        ...(sessao.ok && sessao.caminho ? { caminho: sessao.caminho } : {}),
                    }),
                })
                : lancarProcessoDoRobo({ execPath: process.execPath, id, robo: robo.nome, env: ambiente.env }),
            fechar: (execucao, status, mensagem) => transporte.fecharExecucao(execucao, status, new Date(), mensagem),
            cancelando,
            filhos,
        });
    };
    const cancelarJob = async (id: string): Promise<string> => {
        const f = filhos.get(id);
        if (!f)
            throw new Error(`execução ${id} não está rodando neste agente`);
        cancelando.add(id);
        await f.matar();
        return `processo ${f.pid ?? '?'} do robô ${f.robo} morto pela árvore`;
    };
    return umTique({
        transporte,
        cofreDoJob,
        robos: robosDoPacote(),
        pacoteDeRobos: () => (manifestoCarregado ? { organizacao: manifestoCarregado.organizacao, commit: manifestoCarregado.commit, robos: manifestoCarregado.robos.length } : undefined),
        montagens: () => montagensCarregadas,
        rodando,
        concorrencia: lerConcorrencia(caminhoDaConfig(PASTA)),
        areaDeTrabalho,
        telaNaSessao: sessaoZero,
        executar: executarNoFilho,
        cancelar: cancelarJob,
        celular: {
            parear: (argumento, segredo) => parearPeloAgente(argumento, segredo, rodarAdbPeloCaminho(lerCaminhoDoAdb(caminhoDaConfig(PASTA)))),
        },
        onde: hostname(),
        reiniciar: (contexto) => void powershell(comandoDeReiniciar(process.pid, process.execPath, contexto.robosRodando)).catch(() => undefined),
        canal: canalDeOrdens,
        acesso,
        atualizacao: comoSeAtualizar(endereco, token),
    }).then(() => undefined);
}
if (process.argv[2] === ARGUMENTO_DO_FILHO) {
    const [id, nomeDoRobo] = [process.argv[3] ?? '', process.argv[4] ?? ''];
    const robo = robosDoPacote().find((r) => r.nome === nomeDoRobo);
    const config = lerConfig(caminhoDaConfig(PASTA));
    if (!id || !robo || !config?.endereco || !config?.token) {
        console.error(`--executar-job: id "${id}", robô "${nomeDoRobo}" (${robo ? 'conhecido' : 'DESCONHECIDO'}), config ${config?.token ? 'lida' : 'AUSENTE'}.`);
        process.exit(1);
    }
    aplicarAmbienteDoFilho(PASTA, id);
    const { transporte, cofreDoJob } = transporteHttps(config.endereco, config.token, undefined, (novo) => gravarConfig(caminhoDaConfig(PASTA), configComTokenNovo(lerConfig(caminhoDaConfig(PASTA)), config.endereco, novo)), acessoDaBorda());
    executarJob({ transporte, cofre: cofreDoJob(id), robo, onde: hostname(), id })
        .then(() => process.exit(0))
        .catch((erro) => {
        console.error('--executar-job parou:', erro instanceof Error ? erro.message : erro);
        process.exit(1);
    });
}
else
    void executarCli(process.argv.slice(2), {
        escrever: (l) => console.log(l),
        sair: (c) => process.exit(c),
    }, {
        arquivoConfigPadrao: caminhoDaConfig(PASTA),
        nomeDaMaquina: hostname(),
        lerConfig,
        gravarConfig,
        parear: (endereco, codigo, nome, acesso) => parearAgente(endereco, codigo, nome, fetch, acesso),
        pedirConexao: (endereco, nome) => pedirConexao(endereco, nome),
        esperarConexao: (endereco, dispositivo) => esperarConexao(endereco, dispositivo),
        abrirNoNavegador: async (url) => {
            if (!/^https?:\/\/[A-Za-z0-9.:/-]+$/.test(url))
                return;
            spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        },
        esperar: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
        agoraMs: () => Date.now(),
        interativo: process.stdout.isTTY === true && process.stdin.isTTY === true,
        instalacao: (() => {
            const pasta = pastaDeInstalacao(process.env.LOCALAPPDATA ?? PASTA);
            const exe = join(pasta, 'bot-agente.exe');
            return {
                exe,
                arquivoConfig: caminhoDaConfig(pasta),
                copiar: async () => {
                    if (process.execPath.toLowerCase() === exe.toLowerCase())
                        return;
                    mkdirSync(pasta, { recursive: true });
                    copyFileSync(process.execPath, exe);
                    try {
                        unlinkSync(exe + ':Zone.Identifier');
                    }
                    catch {
                    }
                },
            };
        })(),
        criarAtalhos: async (exe) => {
            const linha = conteudoDoAtalho(exe);
            const pastas = (await powershell("[Environment]::GetFolderPath('Startup'); [Environment]::GetFolderPath('Desktop')"))
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
            for (const p of pastas)
                writeFileSync(join(p, NOME_DO_ATALHO), linha, 'ascii');
        },
        ligarAgente: async (exe) => {
            conteudoDoAtalho(exe);
            spawn('cmd.exe', ['/d', '/c', `start "" /min "${exe}"`], {
                cwd: dirname(exe),
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                windowsVerbatimArguments: true,
            }).unref();
        },
        esperarEnter: () => new Promise<void>((pronto) => {
            process.stdin.resume();
            process.stdin.once('data', () => {
                process.stdin.pause();
                pronto();
            });
        }),
        lerSegredoDaEntrada: () => new Promise<string>((resolve, reject) => {
            let texto = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (p) => {
                texto += p;
            });
            process.stdin.on('end', () => resolve(texto));
            process.stdin.on('error', reject);
        }),
        umaVolta: (endereco, token) => umaVolta(endereco, token),
        iniciarLaco: async ({ intervaloMs, endereco, token }) => {
            const porta = await esperarAntecessorSair(process.pid, process.execPath, async () => lerProcessos(await powershell(comandoDeListarProcessos())), RITMO_PADRAO, pidDeclarado(process.env.SELF_AUTOMATE_ANTECESSOR));
            console.log(`instancia unica: ${porta.motivo}`);
            if (!porta.seguir)
                process.exit(0);
            void buscarNavegadorSePreciso({
                pastaDoAgente: PASTA,
                chavePublica: CHAVES_DE_PUBLICACAO,
                artefato: 'navegador.zip',
                jaInstalado: () => navegadorInstalado(PASTA, existsSync),
                baixar: async () => {
                    const r = await fetch(`${endereco.replace(/\/+$/, '')}/agente/navegador`, {
                        headers: cabecalhosDoPainel(token),
                        signal: AbortSignal.timeout(30 * 60000),
                    });
                    if (!r.ok)
                        throw new Error(`o painel recusou o navegador: HTTP ${r.status}`);
                    return Buffer.from(await r.arrayBuffer());
                },
                baixarAssinatura: async () => {
                    const r = await fetch(`${endereco.replace(/\/+$/, '')}/agente/navegador.sig`, {
                        headers: cabecalhosDoPainel(token),
                        signal: AbortSignal.timeout(60000),
                    });
                    if (!r.ok)
                        return undefined;
                    return Buffer.from(await r.arrayBuffer());
                },
                gravar: async (caminho, conteudo) => {
                    writeFileSync(caminho, conteudo);
                },
                extrair: async (zip, destino) => {
                    mkdirSync(destino, { recursive: true });
                    await powershell(`Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destino}' -Force`);
                },
                apagar: async (caminho) => {
                    rmSync(caminho, { force: true });
                },
            }).then((r) => console.log(`navegador: ${r.mensagem}`));
            void buscarPacotesSePreciso((p) => {
                const destinoFinal = p.forma === 'arquivo' ? `${PASTA}\\${p.arquivo}` : `${PASTA}\\${p.pasta}`;
                const baixado = `${PASTA}\\${p.arquivo}`;
                const marcaDePronto = p.marca ? `${PASTA}\\${p.marca}` : destinoFinal;
                const rota = `${endereco.replace(/\/+$/, '')}/agente/pacote/${p.nome}`;
                return {
                    pastaDoAgente: PASTA,
                    chavePublica: CHAVES_DE_PUBLICACAO,
                    artefato: p.arquivo,
                    jaInstalado: () => existsSync(marcaDePronto),
                    baixar: async () => {
                        const r = await fetch(rota, {
                            headers: cabecalhosDoPainel(token),
                            signal: AbortSignal.timeout(30 * 60000),
                        });
                        if (!r.ok)
                            throw new Error(`o painel recusou \`${p.nome}\`: HTTP ${r.status}`);
                        return Buffer.from(await r.arrayBuffer());
                    },
                    baixarAssinatura: async () => {
                        const r = await fetch(`${rota}.sig`, {
                            headers: cabecalhosDoPainel(token),
                            signal: AbortSignal.timeout(60000),
                        });
                        if (!r.ok)
                            return undefined;
                        return Buffer.from(await r.arrayBuffer());
                    },
                    gravar: async (_caminho, conteudo) => {
                        writeFileSync(baixado, conteudo);
                    },
                    extrair: async (zip, destino) => {
                        if (p.forma === 'arquivo')
                            return;
                        mkdirSync(destino, { recursive: true });
                        await powershell(`Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destino}' -Force`);
                    },
                    apagar: async (caminho) => {
                        if (p.forma === 'arquivo')
                            return;
                        rmSync(caminho, { force: true });
                    },
                };
            }, PACOTES_DE_DISCO.filter((p) => p.nome !== 'navegador' && p.nome !== NOME_DO_PACOTE_DE_ROBOS && p.nome !== NOME_DAS_MONTAGENS)).then((rs) => {
                for (const r of rs)
                    console.log(`${r.nome}: ${r.mensagem}`);
            });
            const rotaDosRobos = `${endereco.replace(/\/+$/, '')}/agente/pacote/${NOME_DO_PACOTE_DE_ROBOS}`;
            const atualizarRobos = async () => {
                const r = await atualizarRobosSePreciso({
                    pasta: PASTA,
                    chavePublica: CHAVES_DE_PUBLICACAO,
                    baixarAssinatura: async () => {
                        const resp = await fetch(`${rotaDosRobos}.sig`, { headers: cabecalhosDoPainel(token), signal: AbortSignal.timeout(60000) });
                        return resp.ok ? Buffer.from(await resp.arrayBuffer()) : undefined;
                    },
                    baixarPacote: async () => {
                        const resp = await fetch(rotaDosRobos, { headers: cabecalhosDoPainel(token), signal: AbortSignal.timeout(10 * 60000) });
                        if (!resp.ok)
                            throw new Error(`o painel recusou o pacote de robôs: HTTP ${resp.status}`);
                        return Buffer.from(await resp.arrayBuffer());
                    },
                }).catch((erro) => ({ trocou: false, mensagem: `falha ao atualizar os robôs: ${erro instanceof Error ? erro.message : String(erro)}` }));
                if (r.trocou)
                    robosCarregados = undefined;
                console.log(`robos: ${r.mensagem}`);
            };
            const rotaDasMontagens = `${endereco.replace(/\/+$/, '')}/agente/pacote/${NOME_DAS_MONTAGENS}`;
            const atualizarMontagens = async () => {
                const r = await atualizarMontagensSePreciso({
                    pasta: PASTA,
                    chavePublica: CHAVES_DE_PUBLICACAO,
                    baixarAssinatura: async () => {
                        const resp = await fetch(`${rotaDasMontagens}.sig`, { headers: cabecalhosDoPainel(token), signal: AbortSignal.timeout(60000) });
                        return resp.ok ? Buffer.from(await resp.arrayBuffer()) : undefined;
                    },
                    baixarConjunto: async () => {
                        const resp = await fetch(rotaDasMontagens, { headers: cabecalhosDoPainel(token), signal: AbortSignal.timeout(60000) });
                        if (!resp.ok)
                            throw new Error(`o painel recusou as montagens: HTTP ${resp.status}`);
                        return Buffer.from(await resp.arrayBuffer());
                    },
                }).catch((erro) => ({ trocou: false, mensagem: `falha ao atualizar as montagens: ${erro instanceof Error ? erro.message : String(erro)}` }));
                if (r.trocou)
                    robosCarregados = undefined;
                console.log(`montagens: ${r.mensagem}`);
            };
            await atualizarRobos();
            await atualizarMontagens();
            setInterval(() => void atualizarRobos().then(atualizarMontagens), INTERVALO_DOS_ROBOS_MS);
            return iniciarLaco({
                intervaloMs,
                umaVolta: () => umaVolta(endereco, token),
                aoFalhar: (e) => console.error('tique falhou:', e instanceof Error ? e.message : e),
            });
        },
        versao: VERSAO,
    }).catch((erro) => {
        console.error('o agente parou:', erro instanceof Error ? erro.message : erro);
        process.exit(1);
    });
