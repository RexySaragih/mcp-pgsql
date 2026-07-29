import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ClientConstants } from '../clients/base-client.js';
import { getPostgresClient } from '../clients/postgres-client.js';
import { sanitizeErrorMessage } from '../clients/base-client.js';
import { formatRowsTable } from '../utils/format.js';
import {
  analyzeQuery,
  assertReadOnlySelect,
  formatPreviewMessage,
  formatSoftConfirmationPrompt,
  formatTransactionPreview,
} from '../utils/sql-safety.js';

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const readQueryTool: Tool = {
  name: 'read_query',
  description:
    'Execute a single SELECT / WITH … SELECT. Mutating SQL rejected. FOR UPDATE/SHARE need confirmed=true. Results are LIMIT-capped.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'SELECT or WITH … SELECT' },
      max_rows: {
        type: 'number',
        description: `Max rows (default ${ClientConstants.DEFAULT_MAX_ROWS}, hard max ${ClientConstants.HARD_MAX_ROWS})`,
      },
      confirmed: {
        type: 'boolean',
        description:
          'Required true for SELECT with FOR UPDATE / FOR SHARE. Otherwise returns a confirmation preview.',
      },
    },
    required: ['sql'],
  },
  annotations: READ_ANNOTATIONS,
};

export const writeQueryTool: Tool = {
  name: 'write_query',
  description:
    'Execute INSERT, UPDATE, or DELETE. Separate from read_query and schema_query. Requires confirmed=true after a strong confirmation preview — nothing runs until then.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'Single INSERT/UPDATE/DELETE statement',
      },
      confirmed: {
        type: 'boolean',
        description:
          'Must be true to execute. If omitted/false, returns an impact preview only — nothing runs.',
        default: false,
      },
    },
    required: ['sql'],
  },
  annotations: WRITE_ANNOTATIONS,
};

export const schemaQueryTool: Tool = {
  name: 'schema_query',
  description:
    'Execute CREATE, ALTER, or DROP (DDL). Separate from write_query. Requires confirmed=true after a strong confirmation preview — nothing runs until then.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'Single CREATE/ALTER/DROP statement',
      },
      confirmed: {
        type: 'boolean',
        description:
          'Must be true to execute. If omitted/false, returns an impact preview only — nothing runs.',
        default: false,
      },
    },
    required: ['sql'],
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};

export const transactionQueryTool: Tool = {
  name: 'transaction_query',
  description:
    'Execute multiple SQL statements in one transaction. Preview lists per-statement risk. Requires confirmed=true after a strong confirmation preview.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'One or more SQL statements separated by semicolons',
      },
      confirmed: {
        type: 'boolean',
        description:
          'Must be true to execute. If omitted/false, returns a per-statement risk preview only.',
        default: false,
      },
    },
    required: ['sql'],
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};

const readSchema = z.object({
  sql: z.string().min(1),
  max_rows: z
    .number()
    .int()
    .positive()
    .max(ClientConstants.HARD_MAX_ROWS)
    .optional(),
  confirmed: z.boolean().optional(),
});

const confirmedSqlSchema = z.object({
  sql: z.string().min(1),
  confirmed: z.boolean().optional(),
});

export async function readQuery(
  sql: string,
  confirmed = false,
  maxRows?: number,
): Promise<string> {
  const gate = assertReadOnlySelect(sql);
  if (!gate.ok) {
    return `Error: ${gate.reason}`;
  }
  if (gate.analysis.needsSoftConfirmation && !confirmed) {
    return formatSoftConfirmationPrompt(
      gate.analysis,
      gate.analysis.normalized,
    );
  }
  try {
    const result = await getPostgresClient().readQuery(
      gate.analysis.normalized,
      maxRows,
    );
    const note =
      gate.analysis.needsSoftConfirmation && confirmed
        ? '\n_Executed after confirmation (lock side effects)._\n\n'
        : '';
    return (
      note +
      formatRowsTable(result.rows as Array<Record<string, unknown>>, {
        durationMs: result.duration,
        truncated: result.truncated,
        title: 'Query results',
      })
    );
  } catch (error: unknown) {
    return `Error executing query: ${sanitizeErrorMessage(error)}`;
  }
}

export async function handleReadQuery(args: unknown): Promise<string> {
  const parsed = readSchema.parse(args ?? {});
  return readQuery(parsed.sql, parsed.confirmed ?? false, parsed.max_rows);
}

export async function writeQuery(
  sql: string,
  confirmed = false,
): Promise<string> {
  const analysis = analyzeQuery(sql);
  if (analysis.isReadOnly) {
    return 'Error: This tool only accepts INSERT, UPDATE, or DELETE. Use read_query for SELECT.';
  }
  if (
    analysis.type === 'CREATE' ||
    analysis.type === 'ALTER' ||
    analysis.type === 'DROP'
  ) {
    return 'Error: Use schema_query for CREATE/ALTER/DROP.';
  }
  if (
    analysis.type !== 'INSERT' &&
    analysis.type !== 'UPDATE' &&
    analysis.type !== 'DELETE' &&
    analysis.type !== 'TRUNCATE'
  ) {
    return `Error: Unsupported write type ${analysis.type}.`;
  }
  if (!confirmed) {
    return formatPreviewMessage(
      analysis,
      analysis.normalized || sql,
      'write_query',
    );
  }
  try {
    const result = await getPostgresClient().query(analysis.normalized || sql);
    return [
      `**Query executed** (${result.duration}ms)`,
      `**Type:** ${analysis.type}`,
      `**Rows affected:** ${result.rowCount ?? 0}`,
    ].join('\n');
  } catch (error: unknown) {
    return `Error executing query: ${sanitizeErrorMessage(error)}`;
  }
}

export async function handleWriteQuery(args: unknown): Promise<string> {
  const parsed = confirmedSqlSchema.parse(args ?? {});
  return writeQuery(parsed.sql, parsed.confirmed ?? false);
}

export async function schemaQuery(
  sql: string,
  confirmed = false,
): Promise<string> {
  const analysis = analyzeQuery(sql);
  if (
    analysis.type !== 'CREATE' &&
    analysis.type !== 'ALTER' &&
    analysis.type !== 'DROP'
  ) {
    return 'Error: schema_query only accepts CREATE, ALTER, or DROP.';
  }
  if (!confirmed) {
    return formatPreviewMessage(
      analysis,
      analysis.normalized || sql,
      'schema_query',
    );
  }
  try {
    const result = await getPostgresClient().query(analysis.normalized || sql);
    return [
      `**Schema change executed** (${result.duration}ms)`,
      `**Type:** ${analysis.type}`,
      `**Rows affected:** ${result.rowCount ?? 0}`,
    ].join('\n');
  } catch (error: unknown) {
    return `Error executing schema query: ${sanitizeErrorMessage(error)}`;
  }
}

export async function handleSchemaQuery(args: unknown): Promise<string> {
  const parsed = confirmedSqlSchema.parse(args ?? {});
  return schemaQuery(parsed.sql, parsed.confirmed ?? false);
}

export async function transactionQuery(
  sql: string,
  confirmed = false,
): Promise<string> {
  if (!confirmed) {
    return formatTransactionPreview(sql);
  }
  try {
    const result = await getPostgresClient().executeTransaction(sql);
    if (!result.success) {
      return `**Transaction failed** (${result.duration}ms)\n\n**Error:** ${result.error}\n\n**Statements before error:** ${result.results.length}`;
    }
    const lines = [
      `**Transaction executed** (${result.duration}ms)`,
      `**Statements:** ${result.results.length}`,
      '',
      '**Results:**',
    ];
    result.results.forEach((stmt, index) => {
      lines.push(`\n${index + 1}. ${stmt.statement}`);
      lines.push(`   - Duration: ${stmt.duration}ms`);
      if (stmt.rowCount !== undefined) {
        lines.push(`   - Rows affected: ${stmt.rowCount}`);
      }
    });
    return lines.join('\n');
  } catch (error: unknown) {
    return `Error executing transaction: ${sanitizeErrorMessage(error)}`;
  }
}

export async function handleTransactionQuery(args: unknown): Promise<string> {
  const parsed = confirmedSqlSchema.parse(args ?? {});
  return transactionQuery(parsed.sql, parsed.confirmed ?? false);
}
