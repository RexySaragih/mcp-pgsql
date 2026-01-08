import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { query } from '../utils/db.js';

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
      { name: 'timestamp_column', type: 'string', description: 'Timestamp column name (e.g., created_at)', required: true },
      { name: 'limit', type: 'number', description: 'Number of rows to return', required: true },
    ],
  },
  {
    id: 'search_text',
    name: 'Search Text',
    description: 'Search for text in a specific column using ILIKE (case-insensitive)',
    sql: 'SELECT * FROM {table} WHERE {column} ILIKE {pattern} LIMIT {limit}',
    parameters: [
      { name: 'table', type: 'string', description: 'Table name', required: true },
      { name: 'column', type: 'string', description: 'Column name to search in', required: true },
      { name: 'pattern', type: 'string', description: 'Search pattern (use % for wildcards, e.g., "%search%")', required: true },
      { name: 'limit', type: 'number', description: 'Maximum number of results', required: false },
    ],
  },
  {
    id: 'get_table_stats',
    name: 'Get Table Statistics',
    description: 'Get statistics about a table including row count, size, and column info',
    sql: `
      SELECT 
        (SELECT COUNT(*) FROM {table}) as row_count,
        pg_size_pretty(pg_total_relation_size('{table}')) as total_size,
        pg_size_pretty(pg_relation_size('{table}')) as table_size,
        pg_size_pretty(pg_indexes_size('{table}')) as indexes_size
    `,
    parameters: [
      { name: 'table', type: 'string', description: 'Table name', required: true },
    ],
  },
  {
    id: 'find_related',
    name: 'Find Related Rows',
    description: 'Find rows in a related table using a foreign key relationship',
    sql: 'SELECT * FROM {related_table} WHERE {foreign_key_column} = {id}',
    parameters: [
      { name: 'related_table', type: 'string', description: 'Related table name', required: true },
      { name: 'foreign_key_column', type: 'string', description: 'Foreign key column name', required: true },
      { name: 'id', type: 'number', description: 'ID value to match', required: true },
    ],
  },
];

export const listTemplatesTool: Tool = {
  name: 'list_templates',
  description: 'List all available predefined query templates',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export async function listTemplates(): Promise<string> {
  const lines: string[] = ['**Available Query Templates:**\n'];
  
  for (const template of templates) {
    lines.push(`### ${template.name} (${template.id})`);
    lines.push(template.description);
    lines.push('');
    lines.push('**SQL Template:**');
    lines.push('```sql');
    lines.push(template.sql);
    lines.push('```');
    lines.push('');
    lines.push('**Parameters:**');
    for (const param of template.parameters) {
      const required = param.required ? ' (required)' : ' (optional)';
      lines.push(`- **${param.name}** (${param.type}): ${param.description}${required}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export const runTemplateTool: Tool = {
  name: 'run_template',
  description: 'Execute a predefined query template with provided parameters',
  inputSchema: {
    type: 'object',
    properties: {
      template_id: {
        type: 'string',
        description: 'ID of the template to run (use list_templates to see available templates)',
      },
      parameters: {
        type: 'object',
        description: 'Parameters to substitute into the template',
        additionalProperties: true,
      },
    },
    required: ['template_id', 'parameters'],
  },
};

// Validate identifier (table/column names) to prevent SQL injection
function validateIdentifier(identifier: string): boolean {
  // Only allow alphanumeric characters, underscores, and dots (for schema.table)
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(identifier);
}

// Escape string value for SQL (simple escaping, but we'll use parameterized queries when possible)
function escapeString(value: string): string {
  // Replace single quotes with two single quotes (SQL standard escaping)
  return value.replace(/'/g, "''");
}

export async function runTemplate(templateId: string, parameters: Record<string, any>): Promise<string> {
  const template = templates.find(t => t.id === templateId);
  
  if (!template) {
    return `Error: Template '${templateId}' not found. Use list_templates to see available templates.`;
  }

  // Validate required parameters
  const missingParams = template.parameters
    .filter(p => p.required && !(p.name in parameters))
    .map(p => p.name);
  
  if (missingParams.length > 0) {
    return `Error: Missing required parameters: ${missingParams.join(', ')}`;
  }

  // Validate identifiers (table/column names) to prevent SQL injection
  const identifierParams = ['table', 'related_table', 'column', 'timestamp_column', 'foreign_key_column'];
  for (const paramName of identifierParams) {
    const value = parameters[paramName];
    if (value !== undefined && typeof value === 'string') {
      if (!validateIdentifier(value)) {
        return `Error: Invalid identifier '${value}'. Identifiers can only contain letters, numbers, underscores, and dots.`;
      }
    }
  }

  // Build SQL by replacing placeholders
  let sql = template.sql;
  const queryParams: any[] = [];
  let paramIndex = 1;

  for (const param of template.parameters) {
    const value = parameters[param.name];
    const placeholder = `{${param.name}}`;
    
    if (value !== undefined) {
      // For identifiers (table/column names), validate and use directly (already validated above)
      if (identifierParams.includes(param.name)) {
        sql = sql.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      }
      // For the dangerous 'where' clause, we'll remove it for safety
      else if (param.name === 'where') {
        // Remove the where clause placeholder - this parameter is too dangerous
        sql = sql.replace(placeholder, '');
        return `Error: The 'where' parameter is not supported for security reasons. Please use read_query for custom WHERE clauses.`;
      }
      // For string values (like pattern), use parameterized queries for safety
      else if (param.type === 'string') {
        // Always use parameterized queries for string values to prevent SQL injection
        // Replace the placeholder (with or without quotes) with a parameter
        const quotedPlaceholder = `'${placeholder}'`;
        if (sql.includes(quotedPlaceholder)) {
          // Placeholder is in quotes, replace quoted version with parameter
          sql = sql.replace(new RegExp(quotedPlaceholder.replace(/[{}]/g, '\\$&'), 'g'), `$${paramIndex}`);
        } else {
          // Placeholder is not in quotes (e.g., ILIKE {pattern}), replace with parameter
          // PostgreSQL will handle the string conversion
          sql = sql.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), `$${paramIndex}`);
        }
        queryParams.push(value);
        paramIndex++;
      }
      // For numeric values, use parameterized queries
      else if (param.type === 'number') {
        if (typeof value !== 'number' && isNaN(Number(value))) {
          return `Error: Parameter '${param.name}' must be a number.`;
        }
        sql = sql.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), `$${paramIndex}`);
        queryParams.push(Number(value));
        paramIndex++;
      }
      // For other types, convert to string and escape
      else {
        sql = sql.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), `'${escapeString(String(value))}'`);
      }
    } else if (param.required) {
      return `Error: Required parameter '${param.name}' is missing.`;
    } else {
      // Handle optional parameters - remove placeholder or use default
      if (param.name === 'where') {
        sql = sql.replace(placeholder, '');
      } else if (param.name === 'limit') {
        sql = sql.replace(new RegExp(`LIMIT\\s+${placeholder}`, 'g'), '');
      } else {
        sql = sql.replace(placeholder, 'NULL');
      }
    }
  }

  // Clean up any double spaces or empty WHERE clauses
  sql = sql.replace(/\s+/g, ' ').trim();
  sql = sql.replace(/WHERE\s+$/i, '');

  try {
    // Use parameterized query if we have parameters, otherwise use direct query
    const result = queryParams.length > 0 
      ? await query(sql, queryParams)
      : await query(sql);
    
    if (result.rows.length === 0) {
      return `Query executed successfully. No rows returned.\n\n**Executed SQL:**\n\`\`\`sql\n${sql}\n\`\`\``;
    }

    const lines: string[] = [
      `**Query executed successfully** (${result.duration}ms)\n`,
      `**Rows returned:** ${result.rowCount}\n`,
      `**Executed SQL:**\n\`\`\`sql\n${sql}\n\`\`\`\n`,
    ];

    // Format results
    if (result.rows.length > 0) {
      const columns = Object.keys(result.rows[0]);
      lines.push('**Results:**\n');
      lines.push('```');
      
      // Header
      lines.push(columns.join(' | '));
      lines.push(columns.map(() => '---').join(' | '));
      
      // Rows (limit to 50 for display)
      const displayRows = result.rows.slice(0, 50);
      for (const row of displayRows) {
        const values = columns.map(col => {
          const val = row[col];
          if (val === null) return 'NULL';
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        });
        lines.push(values.join(' | '));
      }
      
      if (result.rows.length > 50) {
        lines.push(`\n... and ${result.rows.length - 50} more rows`);
      }
      
      lines.push('```');
    }

    return lines.join('\n');
  } catch (error: any) {
    return `Error executing template: ${error.message}\n\n**SQL attempted:**\n\`\`\`sql\n${sql}\n\`\`\``;
  }
}

