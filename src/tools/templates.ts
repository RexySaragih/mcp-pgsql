import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getPostgresClient } from '../clients/postgres-client.js';
import { sanitizeErrorMessage } from '../clients/base-client.js';
import {
  formatRowsTable,
  isSafeIdentifier,
  quoteIdent,
} from '../utils/format.js';

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  sql: string;
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
}

export const templates: QueryTemplate[] = [
  {
    id: 'find_by_id',
    name: 'Find by ID',
    description: 'Find a row by its primary key ID',
    sql: 'SELECT * FROM {table} WHERE id = {id}',
    parameters: [
      { name: 'table', type: 'string', description: 'Table name', required: true },
      { name: 'id', type: 'number', description: 'ID value', required: true },
    ],
  },
  {
    id: 'count_rows',
    name: 'Count Rows',
    description: 'Count total rows in a table',
    sql: 'SELECT COUNT(*) as count FROM {table}',
    parameters: [
      { name: 'table', type: 'string', description: 'Table name', required: true },
    ],
  },
  {
    id: 'find_recent',
    name: 'Find Recent',
    description: 'Find the most recent N rows ordered by a timestamp column',
    sql: 'SELECT * FROM {table} ORDER BY {timestamp_column} DESC LIMIT {limit}',
    parameters: [
      { name: 'table', type: 'string', description: 'Table name', required: true },
      {
        name: 'timestamp_column',
        type: 'string',
        description: 'Timestamp column name',
        required: true,
      },
      { name: 'limit', type: 'number', description: 'Number of rows', required: true },
    ],
  },
  {
    id: 'search_text',
    name: 'Search Text',
    description: 'ILIKE search in a column',
    sql: 'SELECT * FROM {table} WHERE {column} ILIKE {pattern} LIMIT {limit}',
    parameters: [
      { name: 'table', type: 'string', description: 'Table name', required: true },
      { name: 'column', type: 'string', description: 'Column name', required: true },
      { name: 'pattern', type: 'string', description: 'Pattern with % wildcards', required: true },
      { name: 'limit', type: 'number', description: 'Max rows', required: false },
    ],
  },
  {
    id: 'get_table_stats',
    name: 'Get Table Statistics',
    description: 'Row count and relation sizes',
    sql: `
      SELECT
        (SELECT COUNT(*) FROM {table}) as row_count,
        pg_size_pretty(pg_total_relation_size({table_oid_literal}::regclass)) as total_size,
        pg_size_pretty(pg_relation_size({table_oid_literal}::regclass)) as table_size,
        pg_size_pretty(pg_indexes_size({table_oid_literal}::regclass)) as indexes_size
    `,
    parameters: [
      { name: 'table', type: 'string', description: 'Table name (schema.table ok)', required: true },
    ],
  },
  {
    id: 'find_related',
    name: 'Find Related Rows',
    description: 'Find rows via foreign key',
    sql: 'SELECT * FROM {related_table} WHERE {foreign_key_column} = {id}',
    parameters: [
      { name: 'related_table', type: 'string', description: 'Related table', required: true },
      {
        name: 'foreign_key_column',
        type: 'string',
        description: 'FK column',
        required: true,
      },
      { name: 'id', type: 'number', description: 'ID value', required: true },
    ],
  },
];

export const listTemplatesTool: Tool = {
  name: 'list_templates',
  description: 'List predefined query templates',
  inputSchema: { type: 'object', properties: {} },
  annotations: READ_ANNOTATIONS,
};

export async function listTemplates(): Promise<string> {
  const lines: string[] = ['**Available Query Templates:**\n'];
  for (const template of templates) {
    lines.push(`### ${template.name} (${template.id})`);
    lines.push(template.description);
    lines.push('');
    lines.push('```sql');
    lines.push(template.sql.trim());
    lines.push('```');
    lines.push('');
    for (const param of template.parameters) {
      lines.push(
        `- **${param.name}** (${param.type})${param.required ? ' required' : ''}: ${param.description}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

export const runTemplateTool: Tool = {
  name: 'run_template',
  description: 'Execute a predefined query template with parameters',
  inputSchema: {
    type: 'object',
    properties: {
      template_id: { type: 'string' },
      parameters: { type: 'object', additionalProperties: true },
    },
    required: ['template_id', 'parameters'],
  },
  annotations: READ_ANNOTATIONS,
};

const IDENTIFIER_PARAMS = new Set([
  'table',
  'related_table',
  'column',
  'timestamp_column',
  'foreign_key_column',
]);

export async function runTemplate(
  templateId: string,
  parameters: Record<string, unknown>,
): Promise<string> {
  const template = templates.find((item) => item.id === templateId);
  if (!template) {
    return `Error: Template '${templateId}' not found.`;
  }

  const missing = template.parameters
    .filter((param) => param.required && !(param.name in parameters))
    .map((param) => param.name);
  if (missing.length > 0) {
    return `Error: Missing required parameters: ${missing.join(', ')}`;
  }

  for (const paramName of IDENTIFIER_PARAMS) {
    const value = parameters[paramName];
    if (value !== undefined && typeof value === 'string') {
      if (!isSafeIdentifier(value)) {
        return `Error: Invalid identifier '${value}'. Use letters, numbers, underscores, optional schema.table.`;
      }
    }
  }

  let sql = template.sql;
  const queryParams: unknown[] = [];
  let paramIndex = 1;

  // Special handling for get_table_stats — need quoted regclass literal param
  if (templateId === 'get_table_stats') {
    const table = String(parameters.table);
    const quoted = quoteIdent(table);
    sql = `
      SELECT
        (SELECT COUNT(*) FROM ${quoted}) as row_count,
        pg_size_pretty(pg_total_relation_size($1::regclass)) as total_size,
        pg_size_pretty(pg_relation_size($1::regclass)) as table_size,
        pg_size_pretty(pg_indexes_size($1::regclass)) as indexes_size
    `;
    queryParams.push(table);
  } else {
    for (const param of template.parameters) {
      const value = parameters[param.name];
      const placeholder = `{${param.name}}`;
      if (value === undefined) {
        if (param.name === 'limit') {
          sql = sql.replace(new RegExp(`LIMIT\\s+${placeholder}`, 'g'), '');
        } else {
          sql = sql.replaceAll(placeholder, 'NULL');
        }
        continue;
      }

      if (IDENTIFIER_PARAMS.has(param.name)) {
        sql = sql.replaceAll(placeholder, quoteIdent(String(value)));
        continue;
      }

      if (param.type === 'string' || param.type === 'number') {
        sql = sql.replaceAll(placeholder, `$${paramIndex}`);
        queryParams.push(
          param.type === 'number' ? Number(value) : value,
        );
        paramIndex++;
        continue;
      }

      return `Error: Unsupported parameter type for ${param.name}`;
    }
  }

  sql = sql.replace(/\s+/g, ' ').trim();

  try {
    const result = await getPostgresClient().query(
      sql,
      queryParams.length > 0 ? queryParams : undefined,
    );
    const body = formatRowsTable(
      result.rows as Array<Record<string, unknown>>,
      { durationMs: result.duration, title: `Template ${templateId}` },
    );
    return `${body}\n\n**SQL:**\n\`\`\`sql\n${sql}\n\`\`\``;
  } catch (error: unknown) {
    return `Error executing template: ${sanitizeErrorMessage(error)}\n\n**SQL:**\n\`\`\`sql\n${sql}\n\`\`\``;
  }
}

const runTemplateSchema = z.object({
  template_id: z.string().min(1),
  parameters: z.record(z.unknown()),
});

export async function handleRunTemplate(args: unknown): Promise<string> {
  const parsed = runTemplateSchema.parse(args ?? {});
  return runTemplate(parsed.template_id, parsed.parameters);
}
