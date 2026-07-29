import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getPostgresClient } from '../clients/postgres-client.js';
import { sanitizeErrorMessage } from '../clients/base-client.js';
import { assertReadOnlySelect } from '../utils/sql-safety.js';

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const explainQueryTool: Tool = {
  name: 'explain_query',
  description:
    'Run EXPLAIN on a SELECT. analyze defaults to false (plan only). Set analyze=true to actually execute (EXPLAIN ANALYZE).',
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'SELECT query to explain' },
      analyze: {
        type: 'boolean',
        description:
          'If true, runs EXPLAIN ANALYZE (executes the query). Default false.',
        default: false,
      },
      format: {
        type: 'string',
        enum: ['text', 'json', 'xml', 'yaml'],
        default: 'text',
      },
      confirmed: {
        type: 'boolean',
        description: 'Required true when analyze=true',
      },
    },
    required: ['sql'],
  },
  annotations: READ_ANNOTATIONS,
};

export async function explainQuery(
  sql: string,
  analyze = false,
  format: 'text' | 'json' | 'xml' | 'yaml' = 'text',
  confirmed = false,
): Promise<string> {
  const gate = assertReadOnlySelect(sql);
  if (!gate.ok) {
    return `Error: ${gate.reason}`;
  }

  if (analyze && !confirmed) {
    return [
      '## Confirmation required',
      '',
      '**EXPLAIN ANALYZE** will **execute** the SELECT (including any volatile functions).',
      '',
      '### How to approve',
      'Call `explain_query` again with `analyze: true` and `confirmed: true`.',
      '',
      'Or omit `analyze` / set `analyze: false` for a plan-only EXPLAIN.',
    ].join('\n');
  }

  let explainSql = 'EXPLAIN';
  const options: string[] = [];
  if (analyze) options.push('ANALYZE');
  if (format !== 'text') options.push(`FORMAT ${format.toUpperCase()}`);
  if (options.length > 0) {
    explainSql += ` (${options.join(', ')})`;
  }
  explainSql += ` ${gate.analysis.normalized}`;

  try {
    const result = await getPostgresClient().query(explainSql);
    const lines: string[] = [
      '**Query Execution Plan**\n',
      `**Mode:** ${analyze ? 'EXPLAIN ANALYZE (executed)' : 'EXPLAIN (plan only)'}\n`,
      `**Query:**\n\`\`\`sql\n${gate.analysis.normalized}\n\`\`\`\n`,
    ];

    if (format === 'json') {
      try {
        const plan = JSON.parse(String(result.rows[0]['QUERY PLAN']));
        lines.push('**Execution Plan (JSON):**');
        lines.push('```json');
        lines.push(JSON.stringify(plan, null, 2));
        lines.push('```');
      } catch {
        lines.push('**Execution Plan:**');
        lines.push('```');
        for (const row of result.rows) {
          lines.push(String(row['QUERY PLAN']));
        }
        lines.push('```');
      }
    } else {
      lines.push('**Execution Plan:**');
      lines.push('```');
      for (const row of result.rows) {
        lines.push(String(row['QUERY PLAN']));
      }
      lines.push('```');
    }

    const planText = result.rows.map((row) => String(row['QUERY PLAN'])).join('\n');
    const insights: string[] = [];
    if (planText.includes('Seq Scan')) {
      insights.push('⚠️ Sequential scan — consider indexes');
    }
    if (planText.includes('Index Scan') || planText.includes('Index Only Scan')) {
      insights.push('✅ Uses indexes');
    }
    if (planText.includes('Nested Loop')) {
      insights.push('⚠️ Nested loop — may be slow on large datasets');
    }
    lines.push('\n**Insights:**');
    lines.push(
      insights.length > 0
        ? insights.join('\n')
        : '✅ No obvious issues flagged',
    );

    return lines.join('\n');
  } catch (error: unknown) {
    return `Error analyzing query: ${sanitizeErrorMessage(error)}`;
  }
}

const explainSchema = z.object({
  sql: z.string().min(1),
  analyze: z.boolean().optional(),
  format: z.enum(['text', 'json', 'xml', 'yaml']).optional(),
  confirmed: z.boolean().optional(),
});

export async function handleExplainQuery(args: unknown): Promise<string> {
  const parsed = explainSchema.parse(args ?? {});
  return explainQuery(
    parsed.sql,
    parsed.analyze ?? false,
    parsed.format ?? 'text',
    parsed.confirmed ?? false,
  );
}
