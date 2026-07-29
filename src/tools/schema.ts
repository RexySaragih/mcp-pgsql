import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getPostgresClient } from '../clients/postgres-client.js';
import { sanitizeErrorMessage } from '../clients/base-client.js';

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const listSchemasTool: Tool = {
  name: 'list_schemas',
  description: 'List non-system schemas in the PostgreSQL database',
  inputSchema: { type: 'object', properties: {} },
  annotations: READ_ANNOTATIONS,
};

export async function listSchemas(): Promise<string> {
  const result = await getPostgresClient().query(`
    SELECT schema_name, schema_owner
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY schema_name;
  `);
  if (result.rows.length === 0) {
    return 'No schemas found (excluding system schemas).';
  }
  const lines = ['**Schemas:**\n'];
  for (const row of result.rows) {
    lines.push(`- **${row.schema_name}** (owner: ${row.schema_owner})`);
  }
  return lines.join('\n');
}

export const listTablesTool: Tool = {
  name: 'list_tables',
  description:
    'List tables with estimated row counts (pg_class.reltuples). Set exact_counts=true for COUNT(*) (expensive).',
  inputSchema: {
    type: 'object',
    properties: {
      schema: {
        type: 'string',
        description: 'Optional schema filter',
      },
      exact_counts: {
        type: 'boolean',
        description:
          'If true, run COUNT(*) per table (slow on large tables). Default false uses planner estimates.',
        default: false,
      },
    },
  },
  annotations: READ_ANNOTATIONS,
};

export async function listTables(
  schema?: string,
  exactCounts = false,
): Promise<string> {
  let sql = `
    SELECT
      t.table_schema,
      t.table_name,
      t.table_type,
      obj_description(c.oid, 'pg_class') as description,
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = t.table_schema
          AND table_name = t.table_name
      ) as column_count,
      COALESCE(c.reltuples, -1)::bigint as estimated_rows
    FROM information_schema.tables t
    LEFT JOIN pg_class c ON c.relname = t.table_name
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
    WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  `;
  const params: string[] = [];
  if (schema) {
    sql += ` AND t.table_schema = $1`;
    params.push(schema);
  }
  sql += ` ORDER BY t.table_schema, t.table_name;`;

  const result = await getPostgresClient().query(
    sql,
    params.length > 0 ? params : undefined,
  );
  if (result.rows.length === 0) {
    return `No tables found${schema ? ` in schema '${schema}'` : ''}.`;
  }

  const lines: string[] = [
    exactCounts
      ? '**Tables (exact COUNT(*) — expensive):**\n'
      : '**Tables (estimated rows via reltuples):**\n',
  ];
  let currentSchema = '';

  for (const row of result.rows) {
    if (row.table_schema !== currentSchema) {
      currentSchema = String(row.table_schema);
      lines.push(`\n### Schema: **${currentSchema}**`);
    }

    let rowCountLabel = String(row.estimated_rows);
    if (exactCounts) {
      try {
        const countResult = await getPostgresClient().query(
          `SELECT COUNT(*)::bigint as count FROM "${String(row.table_schema).replace(/"/g, '""')}"."${String(row.table_name).replace(/"/g, '""')}"`,
        );
        rowCountLabel = String(countResult.rows[0].count);
      } catch {
        rowCountLabel = 'N/A';
      }
    }

    lines.push(`- **${row.table_name}** (${row.table_type})`);
    lines.push(`  - Columns: ${row.column_count}`);
    lines.push(
      `  - Rows: ${rowCountLabel}${exactCounts ? '' : ' (estimate)'}`,
    );
    if (row.description) {
      lines.push(`  - Description: ${row.description}`);
    }
  }

  return lines.join('\n');
}

const listTablesSchema = z.object({
  schema: z.string().min(1).optional(),
  exact_counts: z.boolean().optional(),
});

export async function handleListTables(args: unknown): Promise<string> {
  const parsed = listTablesSchema.parse(args ?? {});
  return listTables(parsed.schema, parsed.exact_counts ?? false);
}

export const describeTableTool: Tool = {
  name: 'describe_table',
  description:
    'Detailed schema for a table: columns, PK, FKs, indexes',
  inputSchema: {
    type: 'object',
    properties: {
      schema: {
        type: 'string',
        description: 'Schema name (defaults to public)',
      },
      table: { type: 'string', description: 'Table name' },
    },
    required: ['table'],
  },
  annotations: READ_ANNOTATIONS,
};

export async function describeTable(
  schema: string | undefined,
  table: string,
): Promise<string> {
  const schemaName = schema || 'public';
  const client = getPostgresClient();

  const columnsResult = await client.query(
    `
    SELECT column_name, data_type, character_maximum_length,
           is_nullable, column_default, udt_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position;
  `,
    [schemaName, table],
  );

  if (columnsResult.rows.length === 0) {
    return `Table "${schemaName}"."${table}" not found.`;
  }

  const lines: string[] = [`**Table: ${schemaName}.${table}**\n`, '### Columns:'];
  for (const col of columnsResult.rows) {
    let type = String(col.data_type);
    if (col.character_maximum_length) {
      type += `(${col.character_maximum_length})`;
    }
    if (col.udt_name && col.udt_name !== col.data_type) {
      type = String(col.udt_name);
    }
    const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const defaultVal = col.column_default
      ? ` DEFAULT ${col.column_default}`
      : '';
    lines.push(`- **${col.column_name}**: ${type} ${nullable}${defaultVal}`);
  }

  const pkResult = await client.query(
    `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1 AND tc.table_name = $2
    ORDER BY kcu.ordinal_position;
  `,
    [schemaName, table],
  );
  if (pkResult.rows.length > 0) {
    lines.push('\n### Primary Key:');
    lines.push(
      `- ${pkResult.rows.map((row) => row.column_name).join(', ')}`,
    );
  }

  const fkResult = await client.query(
    `
    SELECT kcu.column_name,
           ccu.table_schema AS foreign_table_schema,
           ccu.table_name AS foreign_table_name,
           ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = $1 AND tc.table_name = $2;
  `,
    [schemaName, table],
  );
  if (fkResult.rows.length > 0) {
    lines.push('\n### Foreign Keys:');
    for (const fk of fkResult.rows) {
      lines.push(
        `- **${fk.column_name}** → ${fk.foreign_table_schema}.${fk.foreign_table_name}.${fk.foreign_column_name}`,
      );
    }
  }

  const indexResult = await client.query(
    `
    SELECT
      i.relname AS index_name,
      array_agg(a.attname ORDER BY x.ordinality) AS columns,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality)
      ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
    WHERE n.nspname = $1 AND t.relname = $2 AND t.relkind = 'r'
    GROUP BY i.relname, ix.indisunique, ix.indisprimary
    ORDER BY i.relname;
  `,
    [schemaName, table],
  );
  if (indexResult.rows.length > 0) {
    lines.push('\n### Indexes:');
    for (const idx of indexResult.rows) {
      const flags: string[] = [];
      if (idx.is_unique) flags.push('UNIQUE');
      if (idx.is_primary) flags.push('PRIMARY');
      const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : '';
      const cols = Array.isArray(idx.columns)
        ? idx.columns.join(', ')
        : String(idx.columns);
      lines.push(`- **${idx.index_name}**: ${cols}${flagStr}`);
    }
  }

  return lines.join('\n');
}

const describeSchema = z.object({
  schema: z.string().min(1).optional(),
  table: z.string().min(1),
});

export async function handleDescribeTable(args: unknown): Promise<string> {
  const parsed = describeSchema.parse(args ?? {});
  return describeTable(parsed.schema, parsed.table);
}

export const listRelationshipsTool: Tool = {
  name: 'list_relationships',
  description: 'Show foreign key relationships between tables',
  inputSchema: {
    type: 'object',
    properties: {
      schema: { type: 'string' },
      table: { type: 'string' },
    },
  },
  annotations: READ_ANNOTATIONS,
};

export async function listRelationships(
  schema?: string,
  table?: string,
): Promise<string> {
  let sql = `
    SELECT tc.table_schema, tc.table_name, kcu.column_name,
           ccu.table_schema AS foreign_table_schema,
           ccu.table_name AS foreign_table_name,
           ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  `;
  const params: string[] = [];
  if (schema) {
    sql += ` AND tc.table_schema = $${params.length + 1}`;
    params.push(schema);
  }
  if (table) {
    sql += ` AND tc.table_name = $${params.length + 1}`;
    params.push(table);
  }
  sql += ` ORDER BY tc.table_schema, tc.table_name, tc.constraint_name;`;

  const result = await getPostgresClient().query(
    sql,
    params.length > 0 ? params : undefined,
  );
  if (result.rows.length === 0) {
    return 'No foreign key relationships found for the specified filters.';
  }

  const lines: string[] = ['**Foreign Key Relationships:**\n'];
  let currentTable = '';
  for (const row of result.rows) {
    const tableKey = `${row.table_schema}.${row.table_name}`;
    if (tableKey !== currentTable) {
      currentTable = tableKey;
      lines.push(`\n### ${currentTable}`);
    }
    lines.push(
      `- **${row.column_name}** → ${row.foreign_table_schema}.${row.foreign_table_name}.${row.foreign_column_name}`,
    );
  }
  return lines.join('\n');
}

const relationshipsSchema = z.object({
  schema: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
});

export async function handleListRelationships(args: unknown): Promise<string> {
  try {
    const parsed = relationshipsSchema.parse(args ?? {});
    return await listRelationships(parsed.schema, parsed.table);
  } catch (error: unknown) {
    return sanitizeErrorMessage(error);
  }
}
