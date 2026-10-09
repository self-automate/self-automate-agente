import { taparCredenciais } from './tampa-de-credencial.js';
import { LOGS_DE_PROCESSO, montarRelatorioDeLog, type VarreduraDeLogs } from './log-de-processo.js';
export { taparCredenciais };
export interface EstadoDoNavegador {
    marcasQueFaltam: string[];
    carregou: boolean;
    caminhoDoExecutavel?: string;
    motivo?: string;
}
export interface EstadoDoSsh {
    marcasQueFaltam: string[];
    carregou: boolean;
    versao?: string;
    motivo?: string;
}
export interface AcessoDaMaquina {
    listarPasta(chave: string): Promise<string[]>;
    listarEntrega(chave: string): Promise<{
        alcancou: true;
        itens: string[];
        subpastas: number;
    } | {
        alcancou: false;
        porque: string;
    }>;
    letrasDeUnidadeQueRespondem(): string[];
    lerAmbiente(): Record<string, string | undefined>;
    lerScripts(): Promise<VarreduraDeScripts>;
    lerLogsDoProcesso?(chave: string): Promise<VarreduraDeLogs>;
    lerRelatorio(nome: string): Promise<string>;
    relatoriosLegiveis(): string[];
    pastasDeEntrega(): Record<string, PastaDeEntrega>;
    estadoDoNavegador(): Promise<EstadoDoNavegador>;
    estadoDoSsh(): Promise<EstadoDoSsh>;
    versao(): string;
}
export const RELATORIOS_DA_CASCA = [
    'bot-agente-reinicio.txt',
] as const;
export interface Leitura {
    nome: string;
    resumo: string;
    entrada?: string;
    executar(argumento: string, acesso: AcessoDaMaquina): Promise<string>;
}
export const PASTAS: Record<string, string> = {
    agente: '.',
};
export const NOMES_POR_ALVO = 30;
export function maisRecentePeloNome(itens: readonly string[]): string | null {
    let melhor: {
        nome: string;
        dia: number;
    } | null = null;
    for (const nome of itens) {
        for (const dia of diasNoNome(nome)) {
            if (!melhor || dia > melhor.dia)
                melhor = { nome, dia };
        }
    }
    return melhor?.nome ?? null;
}
function diasNoNome(nome: string): number[] {
    const fora: number[] = [];
    const juntar = (ano: number, mes: number, dia: number) => {
        if (mes < 1 || mes > 12 || dia < 1 || dia > 31)
            return;
        if (ano < 2000 || ano > 2100)
            return;
        fora.push(Date.UTC(ano, mes - 1, dia));
    };
    for (const m of nome.matchAll(/(?<!\d)(\d{2})[-_.]?(\d{2})[-_.]?(\d{4})(?!\d)/g)) {
        juntar(Number(m[3]), Number(m[2]), Number(m[1]));
    }
    for (const m of nome.matchAll(/(?<!\d)(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/g)) {
        juntar(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    return fora;
}
export function janelaEmDiasPelosNomes(itens: readonly string[]): number | null {
    const dias = new Set<number>();
    const juntar = (ano: number, mes: number, dia: number) => {
        if (mes < 1 || mes > 12 || dia < 1 || dia > 31)
            return;
        if (ano < 2000 || ano > 2100)
            return;
        dias.add(Date.UTC(ano, mes - 1, dia));
    };
    for (const nome of itens) {
        for (const m of nome.matchAll(/(?<!\d)(\d{2})[-_.]?(\d{2})[-_.]?(\d{4})(?!\d)/g)) {
            juntar(Number(m[3]), Number(m[2]), Number(m[1]));
        }
        for (const m of nome.matchAll(/(?<!\d)(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/g)) {
            juntar(Number(m[1]), Number(m[2]), Number(m[3]));
        }
    }
    if (dias.size < 2)
        return null;
    const ordenadas = [...dias].sort((a, b) => a - b);
    return (ordenadas[ordenadas.length - 1]! - ordenadas[0]!) / 86400000;
}
export interface PastaDeEntrega {
    caminho: string;
    origem: 'medido' | 'inferido';
}
const VARIAVEIS_VISIVEIS = [
    'TNS_ADMIN',
    'ORACLE_CLIENT_DIR',
    'ORACLE_BINARY_DIR',
    'USERNAME',
] as const;
export interface RaizDeScript {
    caminho: string;
    origem: 'medido' | 'inferido';
}
export const SUFIXO_AA = 'Documents/Automation Anywhere Files/Automation Anywhere';
export const PASTAS_AA = ['My Scripts', 'My Docs'];
export const RAIZ_DOS_PERFIS = 'C:/Users';
export const raizesDoPerfil = (perfil: string, conta: string, contasNoCodigo: readonly string[] = []): RaizDeScript[] => PASTAS_AA.map((pasta) => ({
    caminho: perfil + '/' + SUFIXO_AA + '/' + pasta,
    origem: contasNoCodigo.includes(conta.toLowerCase())
        ? ('medido' as const)
        : ('inferido' as const),
}));
export interface VarreduraDeScripts {
    achados: {
        caminho: string;
        conteudo: string;
    }[];
    raizes: {
        caminho: string;
        origem: RaizDeScript["origem"];
        alcancou: boolean;
        porque?: string;
    }[];
}
export const SCRIPTS_NO_MAXIMO = 400;
const NL_RESP = '\n';
export const funcoesDe = (conteudo: string): string[] => [...conteudo.matchAll(/^\s*(?:function|sub)\s+(\w+)/gim)].map((m) => m[1] as string);
export const LEITURAS: Leitura[] = [
    {
        nome: 'vbscript',
        resumo: 'Os scripts .vbs que as automações abrem. Sem argumento, lista as funções que existem; com o nome de uma função, devolve o corpo do arquivo que a declara.',
        entrada: 'o nome de uma função — vazio lista todas',
        async executar(argumento: string, acesso: AcessoDaMaquina): Promise<string> {
            const { achados: scripts, raizes } = await acesso.lerScripts();
            const fora = raizes.filter((r) => !r.alcancou);
            const naoENoticia = (r: (typeof fora)[number]) => r.origem === 'inferido' && r.porque === 'ENOENT';
            const dignasDeLinha = fora.filter((r) => !naoENoticia(r));
            const colapsadas = fora.length - dignasDeLinha.length;
            const rodape = NL_RESP +
                NL_RESP +
                raizes.filter((r) => r.alcancou).length +
                ' de ' +
                raizes.length +
                ' raiz(es) alcancada(s).' +
                dignasDeLinha
                    .map((r) => NL_RESP + '  nao alcancei [' + r.origem + '] ' + r.caminho + ' — ' + (r.porque ?? 'sem motivo'))
                    .join('') +
                (colapsadas
                    ? NL_RESP + '  + ' + colapsadas + ' perfil(is) sem Automation Anywhere instalado (inferido, ENOENT)'
                    : '');
            if (!scripts.length) {
                return 'Nenhum .vbs encontrado.' + rodape;
            }
            const alvo = argumento.trim();
            if (!alvo) {
                const linhas = scripts.map((s) => {
                    const fns = funcoesDe(s.conteudo);
                    return ('  ' + s.caminho + '  (' + s.conteudo.length + ' B)' + NL_RESP +
                        '      ' + (fns.length ? fns.join(', ') : '(nenhuma funcao declarada)'));
                });
                return (scripts.length + ' arquivo(s) .vbs.' +
                    (scripts.length >= SCRIPTS_NO_MAXIMO
                        ? ' A VARREDURA PAROU NO TETO DE ' + SCRIPTS_NO_MAXIMO + ': pode haver mais.'
                        : '') +
                    ' Peca pelo NOME DA FUNCAO para ver o corpo.' + NL_RESP +
                    linhas.join(NL_RESP) +
                    rodape);
            }
            const declara = (s: {
                conteudo: string;
            }) => funcoesDe(s.conteudo).some((f) => f.toLowerCase() === alvo.toLowerCase());
            const achadas = scripts.filter(declara);
            if (!achadas.length) {
                const todas = [...new Set(scripts.flatMap((s) => funcoesDe(s.conteudo)))].sort();
                return ('Nao achei a funcao "' + alvo + '". Declaradas nos .vbs alcancados: ' +
                    (todas.join(', ') || '(nenhuma)') +
                    '.' +
                    rodape);
            }
            return (achadas
                .map((s) => {
                const { texto, tampadas, semAtribuicao } = taparCredenciais(s.conteudo);
                const aviso = (tampadas
                    ? NL_RESP + '  [' + tampadas + ' linha(s) tampada(s): pareciam credencial]'
                    : '') +
                    (semAtribuicao
                        ? NL_RESP +
                            '  [' +
                            semAtribuicao +
                            ' linha(s) com palavra de credencial sem atribuicao: NAO tampadas, confira]'
                        : '');
                return '=== ' + s.caminho + ' ===' + aviso + NL_RESP + texto;
            })
                .join(NL_RESP + NL_RESP) + rodape);
        },
    },
    {
        nome: 'versao',
        resumo: 'O commit do executável em uso e as variáveis de caminho configuradas nesta máquina.',
        executar: async (_argumento, acesso) => {
            const amb = acesso.lerAmbiente();
            const linhas = [`versão do agente: ${acesso.versao()}`];
            for (const nome of VARIAVEIS_VISIVEIS) {
                const v = (amb[nome] ?? '').trim();
                linhas.push(`${nome}: ${v || '(não definida)'}`);
            }
            return linhas.join('\n');
        },
    },
    {
        nome: 'listar',
        resumo: 'Lista o conteúdo de uma pasta conhecida do agente, pela chave — nunca por caminho.',
        entrada: 'a chave da pasta, como agente',
        executar: async (argumento, acesso) => {
            const chave = (argumento ?? '').trim();
            if (!chave)
                return `Chaves disponíveis: ${Object.keys(PASTAS).join(', ')}.`;
            if (!Object.hasOwn(PASTAS, chave)) {
                return `Chave desconhecida. Use uma destas: ${Object.keys(PASTAS).join(', ')}.`;
            }
            const itens = await acesso.listarPasta(chave);
            return itens.length ? itens.join('\n') : '(pasta vazia)';
        },
    },
    {
        nome: 'log',
        resumo: 'As últimas linhas que o agente registrou nesta execução — o que ele estava fazendo.',
        executar: async () => 'O agente escreve o log na saída padrão da janela em que roda. ' +
            'Enquanto esta leitura não tiver um arquivo para ler, ela diz isso em vez de devolver vazio.',
    },
    {
        nome: 'reinicio',
        resumo: 'O que a última troca de binário fez — se o Stop-Process reclamou e se o antecessor morreu.',
        executar: async (_argumento, acesso) => acesso.lerRelatorio('bot-agente-reinicio.txt'),
    },
    {
        nome: 'relatorio',
        resumo: 'Um relatório que um robô gravou na pasta do agente, pelo nome — sem nome, lista os que se pode pedir.',
        entrada: 'o nome do relatório (deixe vazio para ver a lista)',
        executar: async (argumento, acesso) => {
            const nome = (argumento ?? '').trim();
            const lista = acesso.relatoriosLegiveis();
            if (!nome)
                return lista.length ? `Relatórios que se pode pedir:\n${lista.join('\n')}` : 'Nenhum relatório declarado.';
            return acesso.lerRelatorio(nome);
        },
    },
    {
        nome: 'navegador',
        resumo: 'Prova, DE DENTRO do executável vivo, se o Playwright carrega de disco naquela máquina — e se a extração dos 117,7 MB ficou inteira. É o que decide se os 14 robôs saem do FORA_DO_AGENTE.',
        executar: async (_argumento, acesso) => {
            const e = await acesso.estadoDoNavegador();
            const linhas: string[] = [];
            if (e.marcasQueFaltam.length) {
                linhas.push('NAO INSTALADO — a extracao nao ficou inteira.');
                linhas.push('  faltam:');
                for (const m of e.marcasQueFaltam)
                    linhas.push(`    ${m}`);
            }
            else {
                linhas.push('arquivos: as tres marcas estao no lugar.');
            }
            if (e.carregou) {
                linhas.push(`carregamento: o playwright-core RESOLVEU de disco.`);
                linhas.push(`  chromium.executablePath() = ${e.caminhoDoExecutavel ?? '(sem caminho)'}`);
            }
            else {
                linhas.push('carregamento: o playwright-core NAO resolveu de disco.');
                linhas.push(`  motivo: ${e.motivo ?? '(sem motivo)'}`);
            }
            const inteiro = e.marcasQueFaltam.length === 0 && e.carregou;
            linhas.push('');
            linhas.push(inteiro
                ? 'NAVEGADOR OK — os 14 nomes do FORA_DO_AGENTE podem ser levantados.'
                : 'NAO LEVANTAR os nomes do FORA_DO_AGENTE: robo de navegador ainda morre ao carregar.');
            return linhas.join('\n');
        },
    },
    {
        nome: 'ssh',
        resumo: 'Prova, DE DENTRO do executável vivo, se a biblioteca ssh2 (do sftp.zip) carrega de disco naquela máquina. É o que decide se um robô que fala SSH/SFTP pode rodar ali — a máquina pode não ter cliente SSH.',
        executar: async (_argumento, acesso) => {
            const e = await acesso.estadoDoSsh();
            const linhas: string[] = [];
            if (e.marcasQueFaltam.length) {
                linhas.push('NAO INSTALADO — o sftp.zip nao esta inteiro ao lado do .exe.');
                linhas.push('  faltam:');
                for (const m of e.marcasQueFaltam)
                    linhas.push(`    ${m}`);
            }
            else {
                linhas.push('arquivos: a ssh2 esta no lugar, sob node_modules.');
            }
            if (e.carregou && e.marcasQueFaltam.length) {
                linhas.push(`CARREGOU (ssh2 ${e.versao ?? '?'}), mas a extracao nao esta inteira — nao confiar: ou a marca esta errada, ou o require achou outra copia.`);
            }
            else if (e.carregou) {
                linhas.push(`SSH OK — a ssh2 ${e.versao ?? '(versao nao lida)'} carregou de disco de dentro do executavel.`);
                linhas.push('  Um robo que use SSH pode rodar aqui: o que falta medir e o LOGIN, e isso e o proprio robo.');
            }
            else {
                linhas.push('NAO CARREGA — os arquivos podem ate estar la, mas o require do SEA nao resolve ssh2:');
                linhas.push(`  ${e.motivo ?? '(sem motivo)'}`);
                linhas.push('  Um robo que use SSH morreria no primeiro import; nao o dispare antes de resolver isto.');
            }
            return linhas.join('\n');
        },
    },
    {
        nome: 'rota',
        resumo: 'NÃO MEDE — aponta para a sonda de alcance (o robô que prova os destinos do ' +
            'tnsnames). Vaga reservada para o dia em que a pergunta precisar de resposta ' +
            'sem abrir execução. Não responde alcance de host HTTP: isso não existe hoje.',
        executar: async () => 'Esta leitura NÃO mede alcance — ela aponta.\n' +
            'Para destinos do tnsnames (Oracle): use a sonda de alcance, o robô que os prova ' +
            'todos e reporta à bancada.\n' +
            'Para alcance de host HTTP: NÃO HÁ instrumento no agente. Medido em 24/08/2026, ' +
            'quando um portal da rede do cliente precisou ser provado e só a máquina do ' +
            'cliente o alcança.',
    },
    {
        nome: 'baseline',
        resumo: 'Lista o que o Automation Anywhere tem hoje nas pastas de entrega dos dez processos — só os NOMES dos arquivos, que é o que a comparação de 30 dias usa. Não lê conteúdo, não grava nada.',
        executar: async (_argumento, acesso) => {
            const linhas: string[] = [
                'BASELINE DO AA — nomes de arquivo por pasta de entrega',
                `coletado pelo agente em ${new Date().toISOString()}`,
                '',
            ];
            const unidades = acesso.letrasDeUnidadeQueRespondem();
            linhas.push(`letras de unidade que respondem nesta sessão (local ou rede, não distingue): ` +
                `${unidades.length ? unidades.join(' ') : '(nenhuma)'}`, '');
            const pastas = acesso.pastasDeEntrega();
            if (!Object.keys(pastas).length) {
                linhas.push('Esta organização não declarou pastas de entrega no pacote de robôs — não há o que comparar.');
                return linhas.join('\n');
            }
            let alcancadas = 0;
            for (const [chave, alvo] of Object.entries(pastas)) {
                const r = await acesso.listarEntrega(chave);
                const selo = alvo.origem === 'inferido' ? ' [caminho INFERIDO, nunca respondeu]' : '';
                if (!r.alcancou) {
                    linhas.push(`── ${chave}${selo}: NÃO ALCANCEI — ${r.porque}`);
                    continue;
                }
                alcancadas++;
                if (!r.itens.length) {
                    linhas.push(`── ${chave}${selo}: alcancei e NÃO HÁ ARQUIVO AGORA.`, '     Isto NÃO diz que o robô não produziu: os dez movem ou apagam a saída', '     (medido nos pacotes). Pode ser não-rodou, movido ou expurgado — e este', '     relatório não distingue os três. Procure a pasta de destino antes de concluir.');
                    continue;
                }
                const janela = janelaEmDiasPelosNomes(r.itens);
                const porExecucao = !r.subpastas
                    ? 'NÃO SEI quantos por execução — sem subpasta, dividir seria inventar'
                    : janela !== null && janela > 2
                        ? `NÃO SEI quantos por execução — os nomes cobrem ${janela.toFixed(0)} dias, e uma execução não grava com essa distância`
                        : `${(r.itens.length / r.subpastas).toFixed(1)} arquivo(s) por execução`;
                const recente = maisRecentePeloNome(r.itens);
                const mostrados = [...r.itens].sort().slice(0, NOMES_POR_ALVO);
                const restantes = r.itens.length - mostrados.length;
                linhas.push(`── ${chave}${selo}: ${r.itens.length} arquivo(s) em ${r.subpastas} subpasta(s) · ${porExecucao}`, ...(recente ? [`     mais recente pelo nome: ${recente}`] : []), ...mostrados.map((i) => `     ${i}`), ...(restantes > 0
                    ? [`     ... mais ${restantes} arquivo(s) não listado(s) — corte de ${NOMES_POR_ALVO} por alvo`]
                    : []));
            }
            linhas.push('', alcancadas === 0
                ? '!! NENHUMA pasta foi alcançada. Isto NÃO diz que o AA não produziu nada — diz que a medição não chegou lá. Confira de onde este agente roda antes de concluir qualquer coisa.'
                : `alcancei ${alcancadas} de ${Object.keys(pastas).length} pastas.`);
            return linhas.join('\n');
        },
    },
    {
        nome: 'pegada',
        resumo: 'Quanto o agente está consumindo de memória nesta máquina.',
        executar: async () => {
            const m = process.memoryUsage();
            const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
            return [
                `residente: ${mb(m.rss)}`,
                `heap em uso: ${mb(m.heapUsed)} de ${mb(m.heapTotal)}`,
                `fora do heap: ${mb(m.external)}`,
            ].join('\n');
        },
    },
    {
        nome: 'log-de-processo',
        resumo: 'O log que um robô do AA grava na máquina, pela chave do processo: os arquivos, as linhas de falha e erro dos últimos dias e um trecho do mais recente. Consulta de URL e credenciais saem tampadas.',
        entrada: 'a chave do processo — vazio lista as chaves',
        async executar(argumento: string, acesso: AcessoDaMaquina): Promise<string> {
            const chaves = Object.keys(LOGS_DE_PROCESSO);
            const lista = chaves.map((k) => `  ${k} — ${LOGS_DE_PROCESSO[k]!.descricao}`).join('\n');
            const chave = argumento.trim();
            if (!chave)
                return `Processos com log legível:\n${lista}`;
            if (!Object.hasOwn(LOGS_DE_PROCESSO, chave)) {
                return `Chave de processo desconhecida. Use uma destas:\n${lista}`;
            }
            if (!acesso.lerLogsDoProcesso) {
                return 'Este agente não sabe ler log de processo — é anterior a esta leitura. Atualize o agente e peça de novo.';
            }
            return montarRelatorioDeLog(chave, await acesso.lerLogsDoProcesso(chave));
        },
    },
];
export function leituraDoNome(nome: string | null | undefined): Leitura | undefined {
    if (!nome)
        return undefined;
    return LEITURAS.find((l) => l.nome === nome);
}
