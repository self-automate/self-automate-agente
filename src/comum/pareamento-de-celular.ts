import { randomBytes, randomInt } from 'node:crypto';
export type RodarAdb = (args: string[]) => Promise<string>;
export interface ConviteDePareamento {
    servico: string;
    senha: string;
    textoDoQr: string;
}
export interface Anuncio {
    nome: string;
    tipo: string;
    endereco: string;
}
export interface Pareado {
    endereco: string;
    guid: string;
}
interface Espera {
    rodar: RodarAdb;
    prazoMs?: number;
    intervaloMs?: number;
}
const PAREAMENTO = '_adb-tls-pairing._tcp';
const CONEXAO = '_adb-tls-connect._tcp';
const IP_PORTA = /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/;
export const enderecoValido = (endereco: string): boolean => IP_PORTA.test(endereco);
export const codigoValido = (codigo: string): boolean => /^\d{6}$/.test(codigo);
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function conviteDePareamento(): ConviteDePareamento {
    const servico = `selfautomate-${randomBytes(4).toString('hex')}`;
    let senha = '';
    for (let i = 0; i < 10; i++)
        senha += LETRAS[randomInt(LETRAS.length)];
    return { servico, senha, textoDoQr: `WIFI:T:ADB;S:${servico};P:${senha};;` };
}
export function lerAnuncios(saida: string): Anuncio[] {
    const anuncios: Anuncio[] = [];
    for (const linha of saida.split(/\r?\n/)) {
        const partes = linha.trim().split(/\s+/);
        if (partes.length !== 3)
            continue;
        const [nome, tipo, endereco] = partes as [
            string,
            string,
            string
        ];
        if (tipo.startsWith('_') && IP_PORTA.test(endereco))
            anuncios.push({ nome, tipo, endereco });
    }
    return anuncios;
}
async function esperarAnuncio(nome: string, tipo: string, espera: Espera): Promise<string | undefined> {
    const prazoMs = espera.prazoMs ?? 180000;
    const intervaloMs = espera.intervaloMs ?? 1000;
    const fim = Date.now() + prazoMs;
    for (;;) {
        const achado = lerAnuncios(await espera.rodar(['mdns', 'services'])).find((a) => a.nome === nome && a.tipo === tipo);
        if (achado)
            return achado.endereco;
        if (Date.now() >= fim)
            return undefined;
        await new Promise((r) => setTimeout(r, intervaloMs));
    }
}
export async function esperarAnuncioDePareamento(servico: string, espera: Espera): Promise<string> {
    const endereco = await esperarAnuncio(servico, PAREAMENTO, espera);
    if (!endereco) {
        throw new Error(`O QR não foi lido em ${Math.round((espera.prazoMs ?? 180000) / 1000)} s. Confira se o celular está no mesmo ` +
            'Wi-Fi que este computador e se a tela "Parear o dispositivo com um código QR" está aberta nele.');
    }
    return endereco;
}
async function parear(endereco: string, segredo: string, rodar: RodarAdb): Promise<Pareado> {
    let saida: string;
    try {
        saida = await rodar(['pair', endereco, segredo]);
    }
    catch (e) {
        saida = (e as Error).message;
    }
    saida = saida.replaceAll(segredo, '******').trim();
    const ok = /Successfully paired to \S+ \[guid=([^\]\s]+)\]/.exec(saida);
    if (ok)
        return { endereco, guid: ok[1] as string };
    if (/protocol fault/i.test(saida)) {
        throw new Error('O celular não completou o pareamento: a janela do código fechou antes. Tirar print ou trocar de app ' +
            'fecha essa janela — abra de novo e use o código novo que aparecer.');
    }
    throw new Error(`O celular recusou o pareamento em ${endereco}: ${saida.slice(0, 200)}`);
}
export async function parearPeloConvite(convite: ConviteDePareamento, espera: Espera): Promise<Pareado> {
    const endereco = await esperarAnuncioDePareamento(convite.servico, espera);
    return parear(endereco, convite.senha, espera.rodar);
}
export async function parearPorCodigo(endereco: string, codigo: string, opcoes: {
    rodar: RodarAdb;
}): Promise<Pareado> {
    if (!enderecoValido(endereco)) {
        throw new Error('O endereço tem de ser IP:porta, como o celular mostra (por exemplo 192.168.0.10:37000).');
    }
    if (!codigoValido(codigo))
        throw new Error('O código de pareamento tem 6 dígitos.');
    return parear(endereco, codigo, opcoes.rodar);
}
export async function conectarAnunciado(guid: string, espera: Espera): Promise<string> {
    const endereco = await esperarAnuncio(guid, CONEXAO, espera);
    if (!endereco) {
        throw new Error('O celular pareou, mas não anunciou a porta de conexão. Confira se a depuração por Wi-Fi segue ligada.');
    }
    const saida = (await espera.rodar(['connect', endereco])).trim();
    if (!/^(connected|already connected) to /.test(saida)) {
        throw new Error(`O celular não conectou em ${endereco}: ${saida.slice(0, 200)}`);
    }
    return endereco;
}
