export interface PedidoDoAgente {
    dispositivo: string;
    codigo: string;
    endereco: string;
    intervalo: number;
    expiraEm: number;
    nome: string;
}
export type RespostaDaEspera = {
    tipo: 'pendente';
} | {
    tipo: 'pronto';
    token: string;
    portao?: {
        id: string;
        segredo: string;
    };
} | {
    tipo: 'fim';
    motivo: string;
};
const base = (endereco: string) => endereco.replace(/\/+$/, '');
export async function pedirConexao(endereco: string, nome: string, fetchFn: typeof fetch = fetch): Promise<PedidoDoAgente> {
    const r = await fetchFn(`${base(endereco)}/conexao/pedir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
    });
    if (!r.ok) {
        const corpo = (await r.json().catch(() => ({}))) as {
            erro?: string;
        };
        throw new Error(`o painel recusou o pedido de conexao: ${corpo.erro ?? `HTTP ${r.status}`}`);
    }
    const d = (await r.json().catch(() => ({}))) as Partial<PedidoDoAgente>;
    if (!d.dispositivo || !d.codigo || !d.endereco)
        throw new Error('o painel respondeu o pedido de conexao sem os campos esperados');
    return {
        dispositivo: d.dispositivo,
        codigo: d.codigo,
        endereco: d.endereco,
        intervalo: typeof d.intervalo === 'number' && d.intervalo > 0 ? d.intervalo : 3,
        expiraEm: typeof d.expiraEm === 'number' && d.expiraEm > 0 ? d.expiraEm : 600,
        nome: d.nome ?? nome,
    };
}
export async function esperarConexao(endereco: string, dispositivo: string, fetchFn: typeof fetch = fetch): Promise<RespostaDaEspera> {
    const r = await fetchFn(`${base(endereco)}/conexao/esperar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispositivo }),
    });
    if (r.status === 202)
        return { tipo: 'pendente' };
    const corpo = (await r.json().catch(() => ({}))) as {
        token?: unknown;
        portao?: {
            id?: unknown;
            segredo?: unknown;
        };
        erro?: unknown;
    };
    if (r.status === 200 && typeof corpo.token === 'string' && corpo.token) {
        const p = corpo.portao;
        return p && typeof p.id === 'string' && p.id && typeof p.segredo === 'string' && p.segredo
            ? { tipo: 'pronto', token: corpo.token, portao: { id: p.id, segredo: p.segredo } }
            : { tipo: 'pronto', token: corpo.token };
    }
    if (r.status === 404 || r.status === 410) {
        return { tipo: 'fim', motivo: typeof corpo.erro === 'string' ? corpo.erro : `HTTP ${r.status}` };
    }
    throw new Error(`o painel nao respondeu a espera da conexao: HTTP ${r.status}`);
}
