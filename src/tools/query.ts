import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { query, executeTransaction } from '../utils/db.js';
import { analyzeQuery, formatPreviewMessage } from '../utils/safety.js';

export const readQueryTool: Tool = {
  name: 'read_query',
  description: 'Execute SELECT queries (read-only, safe to execute without confirmation)',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL SELECT query to execute',
      },
    },
    required: ['sql'],
  },
};

export async function readQuery(sql: string): Promise<string> {
  const analysis = analyzeQuery(sql);
  
  if (!analysis.isReadOnly) {
    return `Error: This tool only accepts SELECT queries. For write operations, use write_query. For schema changes, use schema_query.`;
  }

  try {
    const result = await query(sql);
    
    if (result.rows.length === 0) {
      return 'Query executed successfully. No rows returned.';
    }

    const lines: string[] = [
      `**Query executed successfully** (${result.duration}ms)\n`,
      `**Rows returned:** ${result.rowCount}\n`,
    ];

    // Format results as a table
    if (result.rows.length > 0) {
      const columns = Object.keys(result.rows[0]);
      lines.push('**Results:**\n');
      lines.push('```');
      
      // Header
      lines.push(columns.join(' | '));
      lines.push(columns.map(() => '---').join(' | '));
      
      // Rows (limit to 100 for display)
      const displayRows = result.rows.slice(0, 100);
      for (const row of displayRows) {
        const values = columns.map(col => {
          const val = row[col];
          if (val === null) return 'NULL';
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        });
        lines.push(values.join(' | '));
      }
      
      if (result.rows.length > 100) {
        lines.push(`\n... and ${result.rows.length - 100} more rows`);
      }
      
      lines.push('```');
    }

    return lines.join('\n');
  } catch (error: any) {
    return `Error executing query: ${error.message}`;
  }
}

export const writeQueryTool: Tool = {
  name: 'write_query',
  description: 'Execute INSERT, UPDATE, or DELETE queries. Requires confirmation before execution.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL INSERT, UPDATE, or DELETE query to execute',
      },
      confirmed: {
        type: 'boolean',
        description: 'Must be true to actually execute the query. If false or omitted, returns a preview only.',
        default: false,
      },
    },
    required: ['sql'],
  },
};

export async function writeQuery(sql: string, confirmed: boolean = false): Promise<string> {
  const analysis = analyzeQuery(sql);
  
  // Check if it's actually a write query
  if (analysis.isReadOnly) {
    return `Error: This tool only accepts INSERT, UPDATE, or DELETE queries. For SELECT queries, use read_query.`;
  }

  if (analysis.type === 'CREATE' || analysis.type === 'ALTER' || analysis.type === 'DROP') {
    return `Error: This tool only accepts INSERT, UPDATE, or DELETE queries. For schema changes (CREATE/ALTER/DROP), use schema_query.`;
  }

  if (!confirmed) {
    return formatPreviewMessage(analysis, sql);
  }

  try {
    const result = await query(sql);
    
    const lines: string[] = [
      `✅ **Query executed successfully** (${result.duration}ms)\n`,
      `**Query Type:** ${analysis.type}`,
      `**Rows affected:** ${result.rowCount || 0}`,
    ];

    return lines.join('\n');
  } catch (error: any) {
    return `❌ Error executing query: ${error.message}`;
  }
}

export const schemaQueryTool: Tool = {
  name: 'schema_query',
  description: 'Execute CREATE, ALTER, or DROP queries (schema changes). Requires confirmation before execution.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL CREATE, ALTER, or DROP query to execute',
      },
      confirmed: {
        type: 'boolean',
        description: 'Must be true to actually execute the query. If false or omitted, returns a preview only.',
        default: false,
      },
    },
    required: ['sql'],
  },
};

export async function schemaQuery(sql: string, confirmed: boolean = false): Promise<string> {
  const analysis = analyzeQuery(sql);
  
  // Check if it's actually a schema query
  if (analysis.type !== 'CREATE' && analysis.type !== 'ALTER' && analysis.type !== 'DROP') {
    return `Error: This tool only accepts CREATE, ALTER, or DROP queries. For SELECT queries, use read_query. For INSERT/UPDATE/DELETE, use write_query.`;
  }

  if (!confirmed) {
    return formatPreviewMessage(analysis, sql);
  }

  try {
    const result = await query(sql);
    
    const lines: string[] = [
      `✅ **Schema change executed successfully** (${result.duration}ms)\n`,
      `**Query Type:** ${analysis.type}`,
    ];

    if (result.rowCount !== undefined) {
      lines.push(`**Rows affected:** ${result.rowCount}`);
    }

    return lines.join('\n');
  } catch (error: any) {
    return `❌ Error executing schema query: ${error.message}`;
  }
}

export const transactionQueryTool: Tool = {
  name: 'transaction_query',
  description: 'Execute multiple SQL statements in a single transaction. Supports BEGIN/COMMIT blocks, SET ROLE, and any combination of statements. Requires confirmation before execution.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL statements to execute in a transaction (multiple statements separated by semicolons, e.g., BEGIN; SET ROLE role_name; ALTER TABLE ...; COMMIT;)',
      },
      confirmed: {
        type: 'boolean',
        description: 'Must be true to actually execute the transaction. If false or omitted, returns a preview only.',
        default: false,
      },
    },
    required: ['sql'],
  },
};

export async function transactionQuery(sql: string, confirmed: boolean = false): Promise<string> {
  // Check if SQL contains transaction keywords
  const normalized = sql.trim().toUpperCase();
  const hasTransactionKeywords = normalized.includes('BEGIN') || normalized.includes('COMMIT') || normalized.includes('ROLLBACK');
  
  if (!confirmed) {
    const lines: string[] = [];
    lines.push('⚠️  **HIGH WARNING** - Transaction query requires confirmation');
    lines.push('');
    lines.push('**Query Type:** TRANSACTION (multiple statements)');
    lines.push('**Impact:** Will execute multiple SQL statements in a single transaction. All statements will be committed together or rolled back on error.');
    lines.push('');
    lines.push('**Transaction to execute:**');
    lines.push('```sql');
    lines.push(sql);
    lines.push('```');
    lines.push('');
    
    // Count statements
    const statementCount = sql.split(';').filter(s => s.trim().length > 0 && !s.trim().match(/^\s*--/)).length;
    lines.push(`**Number of statements:** ${statementCount}`);
    lines.push('');
    lines.push('To execute this transaction, call the tool again with `confirmed: true`');
    
    return lines.join('\n');
  }

  try {
    const result = await executeTransaction(sql);
    
    if (!result.success) {
      return `❌ **Transaction failed** (${result.duration}ms)\n\n**Error:** ${result.error}\n\n**Statements executed before error:** ${result.results.length}`;
    }

    const lines: string[] = [
      `✅ **Transaction executed successfully** (${result.duration}ms)\n`,
      `**Statements executed:** ${result.results.length}`,
      '',
      '**Statement results:**',
    ];

    result.results.forEach((stmtResult, index) => {
      lines.push(`\n${index + 1}. ${stmtResult.statement}`);
      lines.push(`   - Duration: ${stmtResult.duration}ms`);
      if (stmtResult.rowCount !== undefined) {
        lines.push(`   - Rows affected: ${stmtResult.rowCount}`);
      }
    });

    return lines.join('\n');
  } catch (error: any) {
    return `❌ Error executing transaction: ${error.message}`;
  }
}

