import type pg from 'pg';
export interface Banco {
    pool: pg.Pool;
    fechar(): Promise<void>;
}
