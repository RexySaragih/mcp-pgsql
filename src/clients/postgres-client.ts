import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import {
  ClientConstants,
  optionalEnv,
  parsePositiveInt,
  sanitizeErrorMessage,
} from './base-client.js';
import { applyRowLimit } from '../utils/row-limit.js';

export interface QueryResult {
  rows: QueryResultRow[];
  rowCount: number | null;
  duration: number;
  truncated?: boolean;
}

function parseDatabaseUrl(url: string): {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
} {
  const parsed = new URL(url);
  const sslMode = parsed.searchParams.get('sslmode');
  return {
    host: parsed.hostname || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || undefined,
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password
      ? decodeURIComponent(parsed.password)
      : undefined,
    ssl:
      sslMode === 'require' ||
      sslMode === 'verify-ca' ||
      sslMode === 'verify-full' ||
      sslMode === 'true',
  };
}

function buildPool(): Pool {
  const databaseUrl = optionalEnv('DATABASE_URL');
  const fromUrl = databaseUrl ? parseDatabaseUrl(databaseUrl) : undefined;
  const sslEnv = (optionalEnv('PGSSL') ?? '').toLowerCase() === 'true';
  const timeoutMs = parsePositiveInt(
    optionalEnv('PG_STATEMENT_TIMEOUT_MS'),
    ClientConstants.DEFAULT_TIMEOUT_MS,
  );

  const host = optionalEnv('PGHOST') ?? fromUrl?.host ?? 'localhost';
  const port = parsePositiveInt(
    optionalEnv('PGPORT'),
    fromUrl?.port ?? 5432,
  );
  const database = optionalEnv('PGDATABASE') ?? fromUrl?.database;
  const user = optionalEnv('PGUSER') ?? fromUrl?.user;
  const password = optionalEnv('PGPASSWORD') ?? fromUrl?.password;

  if (!database) {
    throw new Error(
      'Missing PGDATABASE (or database in DATABASE_URL) — set in mcp.json mcpServers.*.env',
    );
  }
  if (!user) {
    throw new Error(
      'Missing PGUSER (or user in DATABASE_URL) — set in mcp.json mcpServers.*.env',
    );
  }

  return new Pool({
    host,
    port,
    database,
    user,
    password,
    max: ClientConstants.POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: ClientConstants.CONNECT_TIMEOUT_MS,
    ssl: sslEnv || fromUrl?.ssl ? { rejectUnauthorized: false } : undefined,
    options: `-c statement_timeout=${timeoutMs}`,
  });
}

export class PostgresClient {
  private readonly pool: Pool;
  readonly maxRows: number;

  constructor(pool: Pool = buildPool()) {
    this.pool = pool;
    this.maxRows = Math.min(
      parsePositiveInt(
        optionalEnv('PG_MAX_ROWS'),
        ClientConstants.DEFAULT_MAX_ROWS,
      ),
      ClientConstants.HARD_MAX_ROWS,
    );
    this.pool.on('error', (error: Error) => {
      console.error(
        'Unexpected error on idle Postgres client:',
        sanitizeErrorMessage(error),
      );
    });
  }

  async ping(): Promise<void> {
    await this.query('SELECT 1 AS ok');
  }

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      return {
        rows: res.rows,
        rowCount: res.rowCount,
        duration: Date.now() - start,
      };
    } catch (error: unknown) {
      throw new Error(`Database query error: ${sanitizeErrorMessage(error)}`);
    }
  }

  async readQuery(sql: string, maxRows?: number): Promise<QueryResult> {
    const limit = Math.min(
      maxRows ?? this.maxRows,
      ClientConstants.HARD_MAX_ROWS,
    );
    const capped = applyRowLimit(sql, limit);
    const result = await this.query(capped);
    const truncated = result.rows.length >= limit;
    return {
      ...result,
      rows: result.rows.slice(0, limit),
      truncated,
    };
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async executeTransaction(sql: string): Promise<{
    success: boolean;
    duration: number;
    results: Array<{ statement: string; rowCount?: number; duration: number }>;
    error?: string;
  }> {
    const client = await this.pool.connect();
    const start = Date.now();
    const results: Array<{
      statement: string;
      rowCount?: number;
      duration: number;
    }> = [];
    let transactionStarted = false;
    let transactionCommitted = false;

    try {
      const statements = sql
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !/^\s*--/.test(part));

      if (statements.length === 0) {
        throw new Error('No valid SQL statements found');
      }

      let hasBeginInStatements = false;
      let hasCommitInStatements = false;
      for (const statement of statements) {
        const normalized = statement.toUpperCase().trim();
        if (normalized === 'BEGIN' || normalized.startsWith('BEGIN ')) {
          hasBeginInStatements = true;
        }
        if (normalized === 'COMMIT' || normalized.startsWith('COMMIT ')) {
          hasCommitInStatements = true;
        }
      }

      if (!hasBeginInStatements) {
        await client.query('BEGIN');
        transactionStarted = true;
      }

      for (const statement of statements) {
        const stmtStart = Date.now();
        const normalized = statement.toUpperCase().trim();
        if (normalized.length === 0) continue;

        if (normalized === 'BEGIN' || normalized.startsWith('BEGIN ')) {
          transactionStarted = true;
        }
        if (normalized === 'COMMIT' || normalized.startsWith('COMMIT ')) {
          transactionCommitted = true;
        }

        try {
          const result = await client.query(statement);
          results.push({
            statement:
              statement.substring(0, 100) +
              (statement.length > 100 ? '...' : ''),
            rowCount: result.rowCount ?? undefined,
            duration: Date.now() - stmtStart,
          });
        } catch (error: unknown) {
          if (transactionStarted && !transactionCommitted) {
            try {
              await client.query('ROLLBACK');
            } catch {
              // ignore
            }
          }
          throw new Error(
            `Error executing statement "${statement.substring(0, 50)}...": ${sanitizeErrorMessage(error)}`,
          );
        }
      }

      if (
        transactionStarted &&
        !transactionCommitted &&
        !hasCommitInStatements
      ) {
        await client.query('COMMIT');
        transactionCommitted = true;
      }

      return {
        success: true,
        duration: Date.now() - start,
        results,
      };
    } catch (error: unknown) {
      if (transactionStarted && !transactionCommitted) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
      }
      return {
        success: false,
        duration: Date.now() - start,
        results,
        error: sanitizeErrorMessage(error),
      };
    } finally {
      client.release();
    }
  }
}

let sharedClient: PostgresClient | null = null;

export function getPostgresClient(): PostgresClient {
  if (!sharedClient) {
    sharedClient = new PostgresClient();
  }
  return sharedClient;
}

/** @deprecated Prefer getPostgresClient().query */
export async function query(
  text: string,
  params?: unknown[],
): Promise<QueryResult> {
  return getPostgresClient().query(text, params);
}

export async function executeTransaction(sql: string) {
  return getPostgresClient().executeTransaction(sql);
}

export async function getClient(): Promise<PoolClient> {
  return getPostgresClient().getClient();
}

export async function closePool(): Promise<void> {
  if (sharedClient) {
    await sharedClient.close();
    sharedClient = null;
  }
}
