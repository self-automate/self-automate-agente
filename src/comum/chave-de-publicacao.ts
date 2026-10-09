import type { ChavesDePublicacao } from './procedencia.js';
export const CHAVE_DE_PUBLICACAO = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMHmFnZRezn0rdQcQM8MpS5hN9/NvwT5PEdd6w7hArdE=
-----END PUBLIC KEY-----
`;
export const CHAVE_DO_COFRE = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgX+lWzarsUC4/BdMDwxp720Z4LB6rb1Fd6zleYfVTcY=
-----END PUBLIC KEY-----
`;
export const CHAVES_DE_PUBLICACAO: ChavesDePublicacao = { v1: CHAVE_DE_PUBLICACAO, v2: CHAVE_DO_COFRE };
export function temChaveDePublicacao(): boolean {
    return CHAVE_DE_PUBLICACAO.includes('BEGIN PUBLIC KEY');
}
