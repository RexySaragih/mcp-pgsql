/**
 * Push a row cap into SQL so Postgres can stop early.
 * Inserts/clamps LIMIT before trailing lock clauses when present.
 */
export function applyRowLimit(sql: string, maxRows: number): string {
  const trimmed = sql.replace(/;+\s*$/, '').trim();
  const lockMatch = trimmed.match(
    /\s+(FOR\s+(?:NO\s+KEY\s+)?UPDATE|FOR\s+(?:KEY\s+)?SHARE)(?:\s+OF\s+[\w.\s,]+)?(?:\s+NOWAIT|\s+SKIP\s+LOCKED)?\s*$/i,
  );

  const head = lockMatch
    ? trimmed.slice(0, lockMatch.index).trimEnd()
    : trimmed;
  const lockSuffix = lockMatch ? lockMatch[0] : '';

  const limitMatch = head.match(/\bLIMIT\s+(\d+)\s*$/i);
  if (limitMatch) {
    const existing = Number(limitMatch[1]);
    const capped = Math.min(existing, maxRows);
    const withoutLimit = head.slice(0, limitMatch.index).trimEnd();
    return `${withoutLimit} LIMIT ${capped}${lockSuffix}`;
  }

  return `${head} LIMIT ${maxRows}${lockSuffix}`;
}
