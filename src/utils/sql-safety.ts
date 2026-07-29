export type QueryType =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'CREATE'
  | 'ALTER'
  | 'DROP'
  | 'TRUNCATE'
  | 'GRANT'
  | 'REVOKE'
  | 'SET'
  | 'BEGIN'
  | 'COMMIT'
  | 'ROLLBACK'
  | 'CALL'
  | 'COPY'
  | 'EXPLAIN'
  | 'UNKNOWN';

export type SqlRiskKind =
  | 'for_update'
  | 'for_share'
  | 'into_outfile'
  | 'volatile_cte';

export interface SqlRiskFlag {
  kind: SqlRiskKind;
  summary: string;
  whatHappens: string;
}

export interface QueryAnalysis {
  type: QueryType;
  isReadOnly: boolean;
  requiresConfirmation: boolean;
  warningLevel: 'NONE' | 'MEDIUM' | 'HIGH';
  estimatedImpact?: string;
  normalized: string;
  risks: SqlRiskFlag[];
  needsSoftConfirmation: boolean;
}

const MUTATING_PREFIXES: QueryType[] = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'CREATE',
  'ALTER',
  'DROP',
  'GRANT',
  'REVOKE',
  'SET',
  'CALL',
  'COPY',
];

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function leadingKeyword(sql: string): string {
  const match = sql.trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : '';
}

function hasMultipleStatements(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  return trimmed.includes(';');
}

function hasForbiddenFileIo(sql: string): boolean {
  const upper = sql.toUpperCase();
  return (
    upper.includes('INTO OUTFILE') ||
    /\bCOPY\s+.+\s+TO\s+/i.test(sql) ||
    /\bCOPY\s+.+\s+FROM\s+PROGRAM\b/i.test(sql)
  );
}

function detectSoftRisks(sql: string): SqlRiskFlag[] {
  const upper = sql.toUpperCase();
  const risks: SqlRiskFlag[] = [];

  if (/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/.test(upper)) {
    risks.push({
      kind: 'for_update',
      summary: 'Row locks (FOR UPDATE)',
      whatHappens:
        'Postgres will take row locks for the duration of this statement (autocommit). Concurrent writers may block briefly. No data is modified unless other statements run in the same transaction.',
    });
  }

  if (/\bFOR\s+(?:KEY\s+)?SHARE\b/.test(upper)) {
    risks.push({
      kind: 'for_share',
      summary: 'Shared locks (FOR SHARE)',
      whatHappens:
        'Matching rows are share-locked until the statement ends; conflicting exclusive writers may wait.',
    });
  }

  return risks;
}

function classifyKeyword(keyword: string): QueryType {
  const known: QueryType[] = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'CREATE',
    'ALTER',
    'DROP',
    'TRUNCATE',
    'GRANT',
    'REVOKE',
    'SET',
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'CALL',
    'COPY',
    'EXPLAIN',
  ];
  return (known as string[]).includes(keyword)
    ? (keyword as QueryType)
    : 'UNKNOWN';
}

function impactFor(type: QueryType): {
  isReadOnly: boolean;
  warningLevel: 'NONE' | 'MEDIUM' | 'HIGH';
  estimatedImpact: string;
} {
  switch (type) {
    case 'SELECT':
    case 'EXPLAIN':
      return {
        isReadOnly: true,
        warningLevel: 'NONE',
        estimatedImpact: 'Read-only',
      };
    case 'INSERT':
    case 'UPDATE':
      return {
        isReadOnly: false,
        warningLevel: 'MEDIUM',
        estimatedImpact: 'Will modify table data',
      };
    case 'DELETE':
    case 'TRUNCATE':
      return {
        isReadOnly: false,
        warningLevel: 'HIGH',
        estimatedImpact: 'Will permanently delete rows',
      };
    case 'CREATE':
    case 'ALTER':
    case 'DROP':
      return {
        isReadOnly: false,
        warningLevel: 'HIGH',
        estimatedImpact: 'Will change database structure',
      };
    case 'GRANT':
    case 'REVOKE':
      return {
        isReadOnly: false,
        warningLevel: 'HIGH',
        estimatedImpact: 'Will change privileges',
      };
    case 'SET':
      return {
        isReadOnly: false,
        warningLevel: 'MEDIUM',
        estimatedImpact: 'Will change session settings (e.g. ROLE)',
      };
    case 'BEGIN':
    case 'COMMIT':
    case 'ROLLBACK':
      return {
        isReadOnly: false,
        warningLevel: 'MEDIUM',
        estimatedImpact: 'Transaction control',
      };
    default:
      return {
        isReadOnly: false,
        warningLevel: 'HIGH',
        estimatedImpact: 'Unknown / potentially mutating statement',
      };
  }
}

/**
 * Classify a single SQL statement (comments stripped).
 * WITH is only read-only when it does not contain mutating verbs.
 */
export function analyzeQuery(sql: string): QueryAnalysis {
  const normalized = stripSqlComments(sql).trim();
  if (!normalized) {
    return {
      type: 'UNKNOWN',
      isReadOnly: false,
      requiresConfirmation: true,
      warningLevel: 'HIGH',
      estimatedImpact: 'Empty SQL',
      normalized: '',
      risks: [],
      needsSoftConfirmation: false,
    };
  }

  const keyword = leadingKeyword(normalized);
  let type = classifyKeyword(keyword);

  // WITH … must be inspected for mutating verbs
  if (keyword === 'WITH') {
    const upper = normalized.toUpperCase();
    const hasMutating = MUTATING_PREFIXES.some((verb) =>
      new RegExp(`\\b${verb}\\b`).test(upper),
    );
    if (hasMutating) {
      type = 'UNKNOWN';
    } else if (/\bSELECT\b/.test(upper)) {
      type = 'SELECT';
    } else {
      type = 'UNKNOWN';
    }
  }

  const meta = impactFor(type);
  const risks = type === 'SELECT' ? detectSoftRisks(normalized) : [];

  return {
    type,
    isReadOnly: meta.isReadOnly,
    requiresConfirmation: !meta.isReadOnly,
    warningLevel: meta.warningLevel,
    estimatedImpact: meta.estimatedImpact,
    normalized,
    risks,
    needsSoftConfirmation: risks.length > 0,
  };
}

export function assertReadOnlySelect(sql: string): {
  ok: boolean;
  reason?: string;
  analysis: QueryAnalysis;
} {
  const analysis = analyzeQuery(sql);
  if (!analysis.normalized) {
    return { ok: false, reason: 'Empty SQL', analysis };
  }
  if (hasMultipleStatements(analysis.normalized)) {
    return {
      ok: false,
      reason: 'Multiple statements are not allowed in read_query',
      analysis,
    };
  }
  if (hasForbiddenFileIo(analysis.normalized)) {
    return {
      ok: false,
      reason: 'File I/O SQL constructs are not allowed',
      analysis,
    };
  }
  if (!analysis.isReadOnly || analysis.type !== 'SELECT') {
    return {
      ok: false,
      reason: `Rejected ${analysis.type} — read_query only accepts SELECT / WITH … SELECT`,
      analysis,
    };
  }
  return { ok: true, analysis };
}

export function formatPreviewMessage(
  analysis: QueryAnalysis,
  sql: string,
  toolName = 'write_query',
): string {
  const lines: string[] = [
    `## ⛔ Confirmation required — nothing executed yet (${analysis.warningLevel})`,
    '',
    `**Tool:** \`${toolName}\``,
    `**Query type:** ${analysis.type}`,
  ];
  if (analysis.estimatedImpact) {
    lines.push(`**Impact:** ${analysis.estimatedImpact}`);
  }
  lines.push(
    '',
    '### What will happen if you approve',
    '- The MCP Postgres user will run this SQL against the **live** database.',
  );
  if (analysis.estimatedImpact) {
    lines.push(`- ${analysis.estimatedImpact}.`);
  }
  lines.push(
    '- There is **no automatic undo**. Rely on backups / PITR outside this tool if you need recovery.',
    '',
    '### Query',
    '```sql',
    sql,
    '```',
    '',
    '### How to approve (strong gate)',
    `1. Re-read the impact above.`,
    `2. Call \`${toolName}\` again with the **exact same \`sql\`**.`,
    `3. Set **\`confirmed: true\`** (boolean true — required).`,
    '',
    'If you are unsure, do **not** confirm. Ask a human or rewrite the SQL.',
  );
  return lines.join('\n');
}

export function formatSoftConfirmationPrompt(
  analysis: QueryAnalysis,
  sql: string,
): string {
  const lines: string[] = [
    '## Confirmation required',
    '',
    'This SELECT is allowed but has side effects beyond a plain read. Nothing has been executed yet.',
    '',
    '### What will happen if you approve',
  ];
  for (const risk of analysis.risks) {
    lines.push(`- **${risk.summary}:** ${risk.whatHappens}`);
  }
  lines.push(
    '',
    '### Query',
    '```sql',
    sql,
    '```',
    '',
    '### How to approve',
    'Call `read_query` again with the **same `sql`** and set `confirmed: true`.',
  );
  return lines.join('\n');
}

export function splitSqlStatements(sql: string): string[] {
  // Naive split — good enough for agent-authored scripts; string literals with `;` may mis-split.
  return stripSqlComments(sql)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function formatTransactionPreview(sql: string): string {
  const statements = splitSqlStatements(sql);
  const lines: string[] = [
    '## ⛔ Confirmation required — TRANSACTION (nothing executed yet)',
    '',
    '### What will happen if you approve',
    '- All statements run in **one Postgres transaction** (BEGIN/COMMIT added if missing).',
    '- On any error the transaction is **ROLLBACK**ed.',
    '- Session changes such as `SET ROLE` apply for the rest of the transaction.',
    '- There is **no automatic undo** after COMMIT.',
    '',
    `**Statement count:** ${statements.length}`,
    '',
    '### Per-statement risk',
  ];

  statements.forEach((statement, index) => {
    const analysis = analyzeQuery(statement);
    lines.push(
      `${index + 1}. \`${analysis.type}\` (${analysis.warningLevel}) — ${analysis.estimatedImpact ?? 'n/a'}`,
    );
    lines.push(`   \`\`\`sql`);
    lines.push(
      `   ${statement.length > 120 ? `${statement.slice(0, 120)}…` : statement}`,
    );
    lines.push(`   \`\`\``);
  });

  lines.push(
    '',
    '### Full SQL',
    '```sql',
    sql,
    '```',
    '',
    '### How to approve (strong gate)',
    '1. Re-read every statement risk above.',
    '2. Call `transaction_query` again with the **exact same `sql`**.',
    '3. Set **`confirmed: true`** (boolean true — required).',
    '',
    'Do not confirm unless every statement is intentional.',
  );

  return lines.join('\n');
}
