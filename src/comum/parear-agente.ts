export async function parearAgente(endereco: string, codigo: string, nome: string, fetchFn: typeof fetch = fetch, acesso?: {
    id: string;
    segredo: string;
}): Promise<{
    token: string;
    portao?: {
        id: string;
        segredo: string;
    };
}> {
    const base = endereco.replace(/\/+$/, '');
    const alvo = `${base}/agente/registrar`;
    let resposta: Response;
    try {
        resposta = await fetchFn(alvo, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(acesso ? { 'CF-Access-Client-Id': acesso.id, 'CF-Access-Client-Secret': acesso.segredo } : {}),
            },
            body: JSON.stringify({ codigo, nome }),
        });
    }
    catch (erro) {
        const motivo = erro instanceof Error ? erro.message : String(erro);
        throw new Error(`nao consegui falar com ${base}: ${motivo}`);
    }
    if (!resposta.ok) {
        let detalhe = `HTTP ${resposta.status}`;
        if (resposta.status === 403 && !acesso) {
            throw new Error('o portão da borda (Cloudflare Access) recusou o pareamento: HTTP 403. ' +
                'Rode de novo com --portao <client-id> e cole o Client Secret na entrada.');
        }
        try {
            const corpo = (await resposta.json()) as {
                erro?: string;
            };
            if (corpo?.erro)
                detalhe = corpo.erro;
        }
        catch {
        }
        throw new Error(`o painel recusou o pareamento: ${detalhe}`);
    }
    const corpo = (await resposta.json().catch(() => ({}))) as {
        token?: string;
        portao?: {
            id?: unknown;
            segredo?: unknown;
        };
    };
    if (!corpo.token)
        throw new Error('o painel respondeu 200 sem token na resposta');
    const p = corpo.portao;
    if (p && typeof p.id === 'string' && p.id && typeof p.segredo === 'string' && p.segredo) {
        return { token: corpo.token, portao: { id: p.id, segredo: p.segredo } };
    }
    return { token: corpo.token };
}
