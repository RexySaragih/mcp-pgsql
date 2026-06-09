import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}

export async function query(text: string, params?: any[]): Promise<any> {
  const pool = getPool();
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    return {
      rows: res.rows,
      rowCount: res.rowCount,
      duration,
    };
  } catch (error: any) {
    throw new Error(`Database query error: ${error.message}`);
  }
}

export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return await pool.connect();
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Execute multiple SQL statements in a transaction.
 * The SQL string can contain multiple statements separated by semicolons.
 * The transaction will be committed if all statements succeed, or rolled back on any error.
 * If the SQL already contains BEGIN/COMMIT statements, they will be used; otherwise, they will be added automatically.
 */
export async function executeTransaction(sql: string): Promise<{
  success: boolean;
  duration: number;
  results: Array<{ statement: string; rowCount?: number; duration: number }>;
  error?: string;
}> {
  const pool = getPool();
  const client = await pool.connect();
  const start = Date.now();
  const results: Array<{ statement: string; rowCount?: number; duration: number }> = [];
  let transactionStarted = false;
  let transactionCommitted = false;

  try {
    // Split SQL into individual statements
    // Remove comments and split by semicolon, but keep statements that might have semicolons in strings
    // For simplicity, we'll split by semicolon and filter out empty statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^\s*--/)); // Remove empty and comment-only lines

    if (statements.length === 0) {
      throw new Error('No valid SQL statements found');
    }

    // Check if SQL already contains BEGIN/COMMIT by examining statements
    let hasBeginInStatements = false;
    let hasCommitInStatements = false;
    
    for (const stmt of statements) {
      const normalizedStmt = stmt.toUpperCase().trim();
      if (normalizedStmt === 'BEGIN' || normalizedStmt.startsWith('BEGIN ')) {
        hasBeginInStatements = true;
      }
      if (normalizedStmt === 'COMMIT' || normalizedStmt.startsWith('COMMIT ')) {
        hasCommitInStatements = true;
      }
    }

    // If no BEGIN is present, start transaction explicitly
    if (!hasBeginInStatements) {
      await client.query('BEGIN');
      transactionStarted = true;
    }

    // Execute each statement
    for (const statement of statements) {
      const stmtStart = Date.now();
      const normalizedStmt = statement.toUpperCase().trim();
      
      // Skip empty statements
      if (normalizedStmt.length === 0) {
        continue;
      }

      // Track transaction state as we execute
      if (normalizedStmt === 'BEGIN' || normalizedStmt.startsWith('BEGIN ')) {
        transactionStarted = true;
      }
      if (normalizedStmt === 'COMMIT' || normalizedStmt.startsWith('COMMIT ')) {
        transactionCommitted = true;
      }

      try {
        const result = await client.query(statement);
        const stmtDuration = Date.now() - stmtStart;
        results.push({
          statement: statement.substring(0, 100) + (statement.length > 100 ? '...' : ''),
          rowCount: result.rowCount ?? undefined,
          duration: stmtDuration,
        });
      } catch (error: any) {
        // If any statement fails, rollback and throw
        if (transactionStarted && !transactionCommitted) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            // Ignore rollback errors
          }
        }
        throw new Error(`Error executing statement "${statement.substring(0, 50)}...": ${error.message}`);
      }
    }

    // If transaction was started by us and not committed by SQL, commit it
    if (transactionStarted && !transactionCommitted && !hasCommitInStatements) {
      await client.query('COMMIT');
      transactionCommitted = true;
    }

    const duration = Date.now() - start;

    return {
      success: true,
      duration,
      results,
    };
  } catch (error: any) {
    // Ensure rollback on error if transaction was started
    if (transactionStarted && !transactionCommitted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // Ignore rollback errors
      }
    }

    const duration = Date.now() - start;
    return {
      success: false,
      duration,
      results,
      error: error.message,
    };
  } finally {
    // Always release the client
    client.release();
  }
}

