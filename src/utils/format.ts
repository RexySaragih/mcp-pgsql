import { ClientConstants } from '../clients/base-client.js';

export function truncateCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      return json.length > ClientConstants.CELL_TRUNCATE
        ? `${json.slice(0, ClientConstants.CELL_TRUNCATE)}…`
        : json;
    } catch {
      return '[unserializable]';
    }
  }
  const text = String(value);
  return text.length > ClientConstants.CELL_TRUNCATE
    ? `${text.slice(0, ClientConstants.CELL_TRUNCATE)}…`
    : text;
}

export function formatRowsTable(
  rows: Array<Record<string, unknown>>,
  options: { durationMs: number; truncated?: boolean; title?: string },
): string {
  const lines: string[] = [];
  if (options.title) lines.push(`## ${options.title}`);
  lines.push(
    `**Rows:** ${rows.length}${options.truncated ? ' (truncated)' : ''} · **Duration:** ${options.durationMs}ms`,
  );
  lines.push('');
  if (rows.length === 0) {
    lines.push('_No rows returned._');
    return lines.join('\n');
  }
  const columns = Object.keys(rows[0]);
  lines.push('```');
  lines.push(columns.join(' | '));
  lines.push(columns.map(() => '---').join(' | '));
  for (const row of rows) {
    lines.push(columns.map((col) => truncateCell(row[col])).join(' | '));
  }
  lines.push('```');
  return lines.join('\n');
}

export function quoteIdent(identifier: string): string {
  // Support schema.table — quote each part
  return identifier
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');
}

export function isSafeIdentifier(identifier: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(
    identifier,
  );
}
