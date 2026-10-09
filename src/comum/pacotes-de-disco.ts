export type FormaDeInstalar = 'zip' | 'arquivo';
export interface PacoteDeDisco {
    nome: string;
    arquivo: string;
    forma: FormaDeInstalar;
    pasta?: string;
    marca?: string;
    porque: string;
}
export const PACOTES_DE_DISCO: readonly PacoteDeDisco[] = [
    {
        nome: 'navegador',
        arquivo: 'navegador.zip',
        forma: 'zip',
        pasta: 'navegador',
        marca: 'navegador\\node_modules\\playwright-core',
        porque: 'o `playwright-core` resolve os próprios arquivos com `require(path.join(...))` em tempo ' +
            'de execução, e num SEA isso quebra: o executável constrói e morre ao carregar, com ' +
            '`ERR_UNKNOWN_BUILTIN_MODULE`, antes de qualquer código do CLI rodar. São 283 MB extraídos ' +
            '— o headless shell, não o Chromium completo, medido olhando qual processo aparece.',
    },
    {
        nome: 'sftp',
        arquivo: 'sftp.zip',
        forma: 'zip',
        pasta: 'node_modules',
        marca: 'node_modules\\ssh2-sftp-client',
        porque: 'o `ssh2-sftp-client` é carregado por `await import()` preguiçoso em `blocos/ftp.ts`, e o ' +
            'esbuild não segue import dinâmico — medido no `.exe` do `ff99938`: 4 ocorrências (só o ' +
            'stub) contra 32 do `basic-ftp`, que é import estático. O robô morreria no primeiro ' +
            '`ftp.conectar` com `protocolo: sftp`, em execução, porque o `--status` passa. ' +
            '0,5 MB, 14 pacotes, zero binário nativo.',
    },
    {
        nome: 'robos',
        arquivo: 'robos.js',
        forma: 'arquivo',
        porque: 'Os robôs da organização (0150, etapa 3): fora da casca, assinados, e trocados sem trocar o executável. ' +
            'Quem baixa e mantém em dia é o atualizador próprio (`atualizar-robos.ts`), não o instalador genérico — ' +
            'que baixa uma vez só e não guarda a prova ao lado. Esta entrada existe para o túnel `/agente/pacote/` servi-lo.',
    },
    {
        nome: 'montagens',
        arquivo: 'montagens.json',
        forma: 'arquivo',
        porque: 'Os robôs montados no Studio de produção, como DADO (0150, 3e3b1): o conjunto da organização, assinado em v2 ' +
            'pelo cofre e interpretado pelo pacote. Quem baixa e mantém em dia é `atualizarMontagensSePreciso`, não o ' +
            'instalador genérico. Esta entrada existe para o túnel `/agente/pacote/` servi-lo — e, desde a 0161 (1a), ' +
            'o console o serve do BANCO (`montagens_publicadas`), não de `entregaveis/`.',
    },
    {
        nome: 'oracle-addon',
        arquivo: 'oracledb-7.0.1-win32-x64.node',
        forma: 'arquivo',
        porque: 'binário nativo, e um SEA não carrega `.node` de dentro do bundle. Necessário só para ' +
            'falar com Oracle anterior ao 12.1 — bancos 11g ainda são comuns em empresa grande. Sem ' +
            'ele o agente conecta apenas em modo thin, e bancos antigos recusam. Entregue à mão até ' +
            '25/08/2026, com a instrução "salve na MESMA pasta, sem renomear".',
    },
];
export function pacoteDoNome(nome: string | null | undefined): PacoteDeDisco | undefined {
    if (!nome)
        return undefined;
    return PACOTES_DE_DISCO.find((p) => p.nome === nome);
}
