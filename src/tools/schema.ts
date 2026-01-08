import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { query } from '../utils/db.js';

export const listSchemasTool: Tool = {
  name: 'list_schemas',
  description: 'List all schemas in the PostgreSQL database',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export async function listSchemas(): Promise<string> {
  const result = await query(`
    SELECT 
      schema_name,
      schema_owner
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY schema_name;
  `);

  if (result.rows.length === 0) {
    return 'No schemas found (excluding system schemas).';
  }

  const lines = ['**Schemas in database:**\n'];
  result.rows.forEach((row: any) => {
    lines.push(`- **${row.schema_name}** (owner: ${row.schema_owner})`);
  });

  return lines.join('\n');
}

export const listTablesTool: Tool = {
  name: 'list_tables',
  description: 'List all tables in the database with row counts and descriptions. Optionally filter by schema.',
  inputSchema: {
    type: 'object',
    properties: {
      schema: {
        type: 'string',
        description: 'Optional schema name to filter tables. Defaults to all schemas.',
      },
    },
  },
};

export async function listTables(schema?: string): Promise<string> {
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
      ) as column_count
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

  const result = await query(sql, params.length > 0 ? params : undefined);

  if (result.rows.length === 0) {
    return `No tables found${schema ? ` in schema '${schema}'` : ''}.`;
  }

  const lines: string[] = ['**Tables in database:**\n'];
  let currentSchema = '';

  for (const row of result.rows) {
    if (row.table_schema !== currentSchema) {
      currentSchema = row.table_schema;
      lines.push(`\n### Schema: **${currentSchema}**`);
    }

    // Get row count
    let rowCount = 'N/A';
    try {
      const countResult = await query(
        `SELECT COUNT(*) as count FROM "${row.table_schema}"."${row.table_name}"`
      );
      rowCount = countResult.rows[0].count;
    } catch (e) {
      // Ignore errors for row count
    }

    lines.push(`- **${row.table_name}** (${row.table_type})`);
    lines.push(`  - Columns: ${row.column_count}`);
    lines.push(`  - Rows: ${rowCount}`);
    if (row.description) {
      lines.push(`  - Description: ${row.description}`);
    }
  }

  return lines.join('\n');
}

export const describeTableTool: Tool = {
  name: 'describe_table',
  description: 'Get detailed schema information for a specific table including columns, types, defaults, constraints, and indexes',
  inputSchema: {
    type: 'object',
    properties: {
      schema: {
        type: 'string',
        description: 'Schema name (defaults to public if not specified)',
      },
      table: {
        type: 'string',
        description: 'Table name (required)',
      },
    },
    required: ['table'],
  },
};

export async function describeTable(schema: string | undefined, table: string): Promise<string> {
  const schemaName = schema || 'public';

  // Get columns
  const columnsResult = await query(`
    SELECT 
      column_name,
      data_type,
      character_maximum_length,
      is_nullable,
      column_default,
      udt_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position;
  `, [schemaName, table]);

  if (columnsResult.rows.length === 0) {
    return `Table "${schemaName}"."${table}" not found.`;
  }

  const lines: string[] = [`**Table: ${schemaName}.${table}**\n`];

  // Columns
  lines.push('### Columns:');
  for (const col of columnsResult.rows) {
    let type = col.data_type;
    if (col.character_maximum_length) {
      type += `(${col.character_maximum_length})`;
    }
    if (col.udt_name && col.udt_name !== col.data_type) {
      type = col.udt_name;
    }

    const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
    
    lines.push(`- **${col.column_name}**: ${type} ${nullable}${defaultVal}`);
  }

  // Primary keys
  const pkResult = await query(`
    SELECT 
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2
    ORDER BY kcu.ordinal_position;
  `, [schemaName, table]);

  if (pkResult.rows.length > 0) {
    lines.push('\n### Primary Key:');
    const pkColumns = pkResult.rows.map((r: any) => r.column_name).join(', ');
    lines.push(`- ${pkColumns}`);
  }

  // Foreign keys
  const fkResult = await query(`
    SELECT
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      tc.constraint_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2;
  `, [schemaName, table]);

  if (fkResult.rows.length > 0) {
    lines.push('\n### Foreign Keys:');
    for (const fk of fkResult.rows) {
      lines.push(
        `- **${fk.column_name}** → ${fk.foreign_table_schema}.${fk.foreign_table_name}.${fk.foreign_column_name}`
      );
    }
  }

  // Indexes
  const indexResult = await query(`
    SELECT
      i.relname AS index_name,
      a.attname AS column_name,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE n.nspname = $1
      AND t.relname = $2
      AND t.relkind = 'r'
    ORDER BY i.relname, a.attnum;
  `, [schemaName, table]);

  if (indexResult.rows.length > 0) {
    lines.push('\n### Indexes:');
    const indexes: Record<string, { columns: string[]; unique: boolean; primary: boolean }> = {};
    for (const idx of indexResult.rows) {
      if (!indexes[idx.index_name]) {
        indexes[idx.index_name] = {
          columns: [],
          unique: idx.is_unique,
          primary: idx.is_primary,
        };
      }
      indexes[idx.index_name].columns.push(idx.column_name);
    }
    for (const [name, info] of Object.entries(indexes)) {
      const flags: string[] = [];
      if (info.unique) flags.push('UNIQUE');
      if (info.primary) flags.push('PRIMARY');
      const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : '';
      lines.push(`- **${name}**: ${info.columns.join(', ')}${flagStr}`);
    }
  }

  return lines.join('\n');
}

export const listRelationshipsTool: Tool = {
  name: 'list_relationships',
  description: 'Show foreign key relationships between tables. Optionally filter by schema or specific table.',
  inputSchema: {
    type: 'object',
    properties: {
      schema: {
        type: 'string',
        description: 'Optional schema name to filter relationships',
      },
      table: {
        type: 'string',
        description: 'Optional table name to show relationships for a specific table',
      },
    },
  },
};

export async function listRelationships(schema?: string, table?: string): Promise<string> {
  let sql = `
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      tc.constraint_name
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

  const result = await query(sql, params.length > 0 ? params : undefined);

  if (result.rows.length === 0) {
    return `No foreign key relationships found${schema || table ? ` for the specified filters` : ''}.`;
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
      `- **${row.column_name}** → ${row.foreign_table_schema}.${row.foreign_table_name}.${row.foreign_column_name}`
    );
  }

  return lines.join('\n');
}

