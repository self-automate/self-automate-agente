import { interpretarArgumentos } from './argumentos-do-agente.js';
import { aplicarCaixaDeTeste, type ConfigDoAgente } from './config-do-agente.js';
import type { Versao } from './versao.js';
import type { LacoEmCurso } from './laco-do-agente.js';
import type { PedidoDoAgente, RespostaDaEspera } from './conexao-do-agente.js';
import { win32 } from 'node:path';
import { NOME_DO_ATALHO } from './primeira-vez.js';
import { NOME_DA_TAREFA } from './reinicio-do-agente.js';
import { planoDeDesinstalacao } from './desinstalacao.js';
export interface EntradaSaida {
    escrever(linha: string): void;
    sair(codigo: number): void;
}
export interface Ambiente {
    arquivoConfigPadrao: string;
    nomeDaMaquina: string;
    lerConfig(arquivo: string): ConfigDoAgente | undefined;
    gravarConfig(arquivo: string, c: ConfigDoAgente): void;
    parear(endereco: string, codigo: string, nome: string, acesso?: {
        id: string;
        segredo: string;
    }): Promise<{
        token: string;
        portao?: {
            id: string;
            segredo: string;
        };
    }>;
    umaVolta(endereco: string, token: string): Promise<void>;
    iniciarLaco(p: {
        intervaloMs: number;
        endereco: string;
        token: string;
    }): LacoEmCurso | Promise<LacoEmCurso>;
    lerSegredoDaEntrada(): Promise<string>;
    versao: Versao;
    pedirConexao?(endereco: string, nome: string): Promise<PedidoDoAgente>;
    esperarConexao?(endereco: string, dispositivo: string): Promise<RespostaDaEspera>;
    abrirNoNavegador?(url: string): Promise<void>;
    esperar?(ms: number): Promise<void>;
    agoraMs?(): number;
    interativo?: boolean;
    instalacao?: {
        exe: string;
        arquivoConfig: string;
        copiar(): Promise<void>;
    };
    criarAtalhos?(exe: string): Promise<void>;
    ligarAgente?(exe: string): Promise<void>;
    esperarEnter?(): Promise<void>;
    desinstalacao?: {
        pastaPadrao: string;
        executavel: string;
        pararAgentes(): Promise<number>;
        apagarTarefa(): Promise<'apagada' | 'nao-existia'>;
        apagarAtalhos(): Promise<number>;
        apagarPastaAoSair(pasta: string): Promise<void>;
    };
}
const AJUDA = `
bot-agente - o agente do Self Automate

  bot-agente --instalar <codigo>   pareia com o painel e grava a config
  bot-agente --instalar <codigo> --portao <client-id>
                                   pareia ja pelo portao do Cloudflare Access;
                                   o SEGREDO vem pela ENTRADA PADRAO
  bot-agente                       roda o laco
  bot-agente --status              config, versao e se esta pareado
  bot-agente --testar              uma volta so, sem laco
  bot-agente --conectar            conecta este computador: abre o navegador e
                                   espera alguem confirmar, logado no painel
  bot-agente --portao <client-id>  grava o par do Cloudflare Access
                                   o SEGREDO vem pela ENTRADA PADRAO, nunca
                                   por argumento: linha de comando e visivel
                                   para qualquer conta com sessao na maquina
  bot-agente --desinstalar         para o agente e apaga os atalhos, a tarefa
                                   agendada e a pasta instalada

Opcoes:
  --intervalo <segundos>           padrao 5
  --endereco <url>                 vence a config gravada
`.trim();
export async function executarCli(argv: string[], io: EntradaSaida, amb: Ambiente): Promise<void> {
    const { comando, opcoes } = interpretarArgumentos(argv, amb.arquivoConfigPadrao);
    if (comando.tipo === 'ajuda') {
        if (comando.erro)
            io.escrever(`erro: ${comando.erro}`);
        io.escrever(AJUDA);
        io.sair(comando.erro ? 1 : 0);
        return;
    }
    if (comando.tipo === 'desinstalar') {
        await desinstalar(io, amb);
        return;
    }
    if (comando.tipo === 'instalar') {
        let acesso: {
            id: string;
            segredo: string;
        } | undefined;
        if (comando.portaoId) {
            const segredo = (await amb.lerSegredoDaEntrada()).trim();
            if (!segredo) {
                io.escrever('erro: nao veio segredo pela entrada padrao — nada foi pareado, o codigo continua valendo.');
                io.escrever('use:  bot-agente --instalar <codigo> --portao <client-id>   e cole o Client Secret');
                io.sair(1);
                return;
            }
            acesso = { id: comando.portaoId, segredo };
        }
        try {
            const r = await amb.parear(opcoes.endereco, comando.codigo, amb.nomeDaMaquina, acesso);
            const portao = r.portao ?? acesso;
            amb.gravarConfig(opcoes.arquivoConfig, {
                endereco: opcoes.endereco,
                token: r.token,
                ...(portao ? { acessoId: portao.id, acessoSegredo: portao.segredo } : {}),
            });
            io.escrever(`pareado com ${opcoes.endereco}`);
            if (portao)
                io.escrever(`portao gravado: ${portao.id}`);
            io.escrever(`config gravada em ${opcoes.arquivoConfig}`);
        }
        catch (erro) {
            io.escrever(`erro: ${erro instanceof Error ? erro.message : String(erro)}`);
            io.sair(1);
        }
        return;
    }
    if (comando.tipo === 'conectar') {
        if (!(await conectarPeloNavegador(io, amb, opcoes.endereco, opcoes.arquivoConfig)))
            io.sair(1);
        return;
    }
    const config = amb.lerConfig(opcoes.arquivoConfig);
    if (comando.tipo === 'rodar' && !config && amb.interativo && amb.instalacao) {
        await primeiraVez(io, amb, amb.instalacao, opcoes.endereco);
        return;
    }
    if (comando.tipo === 'portao') {
        if (!config) {
            io.escrever('erro: esta maquina ainda nao esta pareada.');
            io.escrever('rode: bot-agente --instalar <codigo>');
            io.sair(1);
            return;
        }
        const segredo = (await amb.lerSegredoDaEntrada()).trim();
        if (!segredo) {
            io.escrever('erro: nao veio segredo pela entrada padrao.');
            io.escrever('use:  bot-agente --portao <client-id>   e cole o Client Secret');
            io.sair(1);
            return;
        }
        amb.gravarConfig(opcoes.arquivoConfig, {
            ...config,
            acessoId: comando.id,
            acessoSegredo: segredo,
        });
        io.escrever(`portao gravado: ${comando.id}`);
        io.escrever(`config ....... ${opcoes.arquivoConfig}`);
        io.escrever('o agente passa a usar o portao no PROXIMO arranque.');
        return;
    }
    if (comando.tipo === 'status') {
        io.escrever(`versao ....... ${amb.versao.commit}`);
        io.escrever(`config ....... ${opcoes.arquivoConfig}`);
        if (!config) {
            io.escrever('estado ....... nao pareado — rode com --instalar <codigo>');
            return;
        }
        io.escrever(`painel ....... ${config.endereco}`);
        io.escrever('estado ....... pareado');
        return;
    }
    if (!config) {
        io.escrever('erro: este agente nao esta pareado.');
        io.escrever('rode: bot-agente --instalar <codigo>');
        io.escrever('o codigo sai em Setup > Pareamento, no painel, e aparece uma vez so.');
        io.sair(1);
        return;
    }
    const endereco = opcoes.enderecoExplicito ? opcoes.endereco : config.endereco;
    if (comando.tipo === 'testar') {
        await amb.umaVolta(endereco, config.token);
        return;
    }
    if (comando.tipo !== 'rodar') {
        const naoTratado: never = comando;
        void naoTratado;
        io.escrever('erro: comando nao reconhecido.');
        io.escrever(AJUDA);
        io.sair(1);
        return;
    }
    aplicarCaixaDeTeste(config);
    if (config.emailDeTeste) {
        io.escrever(`e-mail desviado para a caixa de teste declarada na config`);
    }
    const laco = await amb.iniciarLaco({
        intervaloMs: opcoes.intervaloMs,
        endereco,
        token: config.token,
    });
    io.escrever(`agente no ar, falando com ${endereco} a cada ${opcoes.intervaloMs / 1000}s`);
    const encerrar = async () => {
        io.escrever('encerrando...');
        await laco.parar();
        io.sair(0);
    };
    process.on('SIGINT', () => void encerrar());
    process.on('SIGTERM', () => void encerrar());
}
async function conectarPeloNavegador(io: EntradaSaida, amb: Ambiente, endereco: string, arquivoConfig: string): Promise<boolean> {
    const { pedirConexao, esperarConexao } = amb;
    const esperar = amb.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const agoraMs = amb.agoraMs ?? Date.now;
    if (!pedirConexao || !esperarConexao) {
        io.escrever('erro: este agente nao sabe conectar pelo navegador.');
        return false;
    }
    let pedido: PedidoDoAgente;
    try {
        pedido = await pedirConexao(endereco, amb.nomeDaMaquina);
    }
    catch (erro) {
        io.escrever(`erro: ${erro instanceof Error ? erro.message : String(erro)}`);
        return false;
    }
    io.escrever(`Conectar este computador (${pedido.nome}) ao Self Automate.`);
    io.escrever(`Abrindo o navegador para voce confirmar. Se ele nao abrir, acesse:`);
    io.escrever(`   ${pedido.endereco}`);
    io.escrever(`Confira o codigo na pagina: ${pedido.codigo.slice(0, 4)}-${pedido.codigo.slice(4)}`);
    await amb.abrirNoNavegador?.(pedido.endereco).catch(() => undefined);
    const fim = agoraMs() + pedido.expiraEm * 1000;
    while (agoraMs() < fim) {
        await esperar(pedido.intervalo * 1000);
        let r: RespostaDaEspera;
        try {
            r = await esperarConexao(endereco, pedido.dispositivo);
        }
        catch {
            continue;
        }
        if (r.tipo === 'pendente')
            continue;
        if (r.tipo === 'fim') {
            io.escrever(`erro: ${r.motivo}`);
            return false;
        }
        amb.gravarConfig(arquivoConfig, {
            endereco,
            token: r.token,
            ...(r.portao ? { acessoId: r.portao.id, acessoSegredo: r.portao.segredo } : {}),
        });
        io.escrever('Conectado! Este computador ja aparece em Dispositivos.');
        if (r.portao)
            io.escrever(`portao gravado: ${r.portao.id}`);
        io.escrever(`config gravada em ${arquivoConfig}`);
        return true;
    }
    io.escrever('erro: ninguem confirmou a conexao a tempo. Rode de novo: bot-agente --conectar');
    return false;
}
async function primeiraVez(io: EntradaSaida, amb: Ambiente, instalacao: NonNullable<Ambiente['instalacao']>, endereco: string): Promise<void> {
    const fechar = async (codigo: number) => {
        io.escrever('');
        io.escrever('  Tecle Enter para fechar.');
        await amb.esperarEnter?.();
        io.sair(codigo);
    };
    const falhou = async (texto: string) => {
        io.escrever('');
        io.escrever(`  [ FALHOU ]  ${texto}`);
        await fechar(1);
    };
    io.escrever('');
    io.escrever('  SELF AUTOMATE - CONECTAR ESTE COMPUTADOR');
    io.escrever('');
    if (amb.lerConfig(instalacao.arquivoConfig)) {
        await amb.ligarAgente?.(instalacao.exe).catch(() => undefined);
        io.escrever('  [ OK ]  Este computador ja esta conectado. O agente foi ligado.');
        io.escrever('         Ele aparece em Meus dispositivos, no painel.');
        await fechar(0);
        return;
    }
    io.escrever('  Isto vai:');
    io.escrever(`    - copiar o agente para ${win32.dirname(instalacao.exe)}`);
    io.escrever('    - abrir o navegador para voce confirmar a conexao com o painel');
    io.escrever(`    - criar o atalho "${NOME_DO_ATALHO}" na Inicializacao do Windows e na Area de Trabalho`);
    io.escrever('  Para desfazer depois: bot-agente --desinstalar');
    io.escrever('');
    io.escrever('  Tecle Enter para continuar, ou feche esta janela para cancelar.');
    await amb.esperarEnter?.();
    io.escrever('');
    try {
        await instalacao.copiar();
    }
    catch (erro) {
        await falhou(`nao consegui copiar o agente para ${instalacao.exe}: ${erro instanceof Error ? erro.message : String(erro)}`);
        return;
    }
    io.escrever('  1/3  O navegador vai abrir: confira o codigo e clique em Conectar.');
    io.escrever('');
    if (!(await conectarPeloNavegador(io, amb, endereco, instalacao.arquivoConfig))) {
        await falhou('a conexao nao foi confirmada. Abra este arquivo de novo para tentar outra vez.');
        return;
    }
    io.escrever('');
    io.escrever('  2/3  Criando os atalhos...');
    try {
        await amb.criarAtalhos?.(instalacao.exe);
    }
    catch {
        io.escrever('       (nao consegui criar os atalhos: o agente liga agora, mas nao sozinho ao entrar no Windows)');
    }
    io.escrever('  3/3  Ligando o agente...');
    try {
        await amb.ligarAgente?.(instalacao.exe);
    }
    catch (erro) {
        await falhou(`conectado, mas o agente nao ligou: ${erro instanceof Error ? erro.message : String(erro)}`);
        return;
    }
    io.escrever('');
    io.escrever('  [ OK ]  Pronto! Este computador esta conectado e aparece em Meus dispositivos.');
    io.escrever('         O agente liga sozinho sempre que voce entrar no Windows.');
    await fechar(0);
}
async function desinstalar(io: EntradaSaida, amb: Ambiente): Promise<void> {
    const d = amb.desinstalacao;
    if (!d) {
        io.escrever('erro: este executavel nao sabe se desinstalar.');
        io.sair(1);
        return;
    }
    if (!amb.interativo) {
        io.escrever('erro: --desinstalar precisa de uma janela, para voce ler o que vai ser apagado e confirmar.');
        io.sair(1);
        return;
    }
    const plano = planoDeDesinstalacao({ executavel: d.executavel, pastaPadrao: d.pastaPadrao });
    io.escrever('');
    io.escrever('  SELF AUTOMATE - DESINSTALAR O AGENTE');
    io.escrever('');
    io.escrever('  Isto vai:');
    io.escrever('    - parar o agente deste computador');
    io.escrever(`    - apagar a tarefa agendada ${NOME_DA_TAREFA}, se existir`);
    io.escrever(`    - apagar o atalho "${NOME_DO_ATALHO}" da Inicializacao do Windows e da Area de Trabalho`);
    io.escrever(`    - apagar a pasta ${plano.pasta} (o agente, a configuracao e a conexao deste computador)`);
    if (plano.fica)
        io.escrever(`  O arquivo ${plano.fica} foi posto a mao fora dessa pasta e nao e apagado.`);
    io.escrever('  O computador continua listado no painel: remova-o em Meus dispositivos.');
    io.escrever('');
    io.escrever('  Tecle Enter para desinstalar, ou feche esta janela para cancelar.');
    await amb.esperarEnter?.();
    io.escrever('');
    let falhou = false;
    const passo = async (nome: string, fazer: () => Promise<string>) => {
        try {
            io.escrever(`  [ OK ]  ${await fazer()}`);
        }
        catch (erro) {
            falhou = true;
            io.escrever(`  [ FALHOU ]  ${nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
        }
    };
    await passo('parar o agente', async () => `agente parado (${await d.pararAgentes()} processo(s))`);
    await passo('apagar a tarefa agendada', async () => (await d.apagarTarefa()) === 'apagada' ? `tarefa ${NOME_DA_TAREFA} apagada` : `tarefa ${NOME_DA_TAREFA}: nao existia`);
    await passo('apagar os atalhos', async () => `${await d.apagarAtalhos()} atalho(s) apagado(s)`);
    await passo('apagar a pasta', async () => {
        await d.apagarPastaAoSair(plano.pasta);
        return `a pasta ${plano.pasta} sai assim que esta janela fechar`;
    });
    io.escrever('');
    io.escrever(falhou ? '  Desinstalado em parte — veja acima o que falhou.' : '  Pronto: o agente foi desinstalado.');
    io.escrever('  Tecle Enter para fechar.');
    await amb.esperarEnter?.();
    io.sair(falhou ? 1 : 0);
}
