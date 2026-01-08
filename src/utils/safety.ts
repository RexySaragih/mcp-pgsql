export type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'ALTER' | 'DROP' | 'TRUNCATE' | 'UNKNOWN';

export interface QueryAnalysis {
  type: QueryType;
  isReadOnly: boolean;
  requiresConfirmation: boolean;
  warningLevel: 'NONE' | 'MEDIUM' | 'HIGH';
  estimatedImpact?: string;
}

export function analyzeQuery(sql: string): QueryAnalysis {
  const normalized = sql.trim().toUpperCase();
  
  // Check for SELECT queries (read-only)
  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) {
    return {
      type: 'SELECT',
      isReadOnly: true,
      requiresConfirmation: false,
      warningLevel: 'NONE',
    };
  }

  // Check for INSERT queries
  if (normalized.startsWith('INSERT')) {
    return {
      type: 'INSERT',
      isReadOnly: false,
      requiresConfirmation: true,
      warningLevel: 'MEDIUM',
      estimatedImpact: 'Will insert new rows',
    };
  }

  // Check for UPDATE queries
  if (normalized.startsWith('UPDATE')) {
    return {
      type: 'UPDATE',
      isReadOnly: false,
      requiresConfirmation: true,
      warningLevel: 'MEDIUM',
      estimatedImpact: 'Will modify existing rows',
    };
  }

  // Check for DELETE queries
  if (normalized.startsWith('DELETE')) {
    return {
      type: 'DELETE',
      isReadOnly: false,
      requiresConfirmation: true,
      warningLevel: 'HIGH',
      estimatedImpact: 'Will permanently delete rows',
    };
  }

  // Check for TRUNCATE queries
  if (normalized.startsWith('TRUNCATE')) {
    return {
      type: 'TRUNCATE',
      isReadOnly: false,
      requiresConfirmation: true,
      warningLevel: 'HIGH',
      estimatedImpact: 'Will permanently delete all rows from table(s)',
    };
  }

  // Check for CREATE queries (schema changes)
  if (normalized.startsWith('CREATE')) {
    return {
      type: 'CREATE',
      isReadOnly: false,
      requiresConfirmation: true,
      warningLevel: 'HIGH',
      estimatedImpact: 'Will create new database objects',
    };
  }

  // Check for ALTER queries (schema changes)
  if (normalized.startsWith('ALTER')) {
    return {
      type: 'ALTER',
      isReadOnly: false,
      requiresConfirmation: true,
      warningLevel: 'HIGH',
      estimatedImpact: 'Will modify database structure',
    };
  }

  // Check for DROP queries (schema changes)
  if (normalized.startsWith('DROP')) {
    return {
      type: 'DROP',
      isReadOnly: false,
      requiresConfirmation: true,
      warningLevel: 'HIGH',
      estimatedImpact: 'Will permanently delete database objects',
    };
  }

  // Unknown query type
  return {
    type: 'UNKNOWN',
    isReadOnly: false,
    requiresConfirmation: true,
    warningLevel: 'HIGH',
    estimatedImpact: 'Unknown query type - review carefully',
  };
}

export function formatPreviewMessage(analysis: QueryAnalysis, sql: string): string {
  const lines: string[] = [];
  
  lines.push(`⚠️  **${analysis.warningLevel} WARNING** - This query requires confirmation`);
  lines.push('');
  lines.push(`**Query Type:** ${analysis.type}`);
  if (analysis.estimatedImpact) {
    lines.push(`**Impact:** ${analysis.estimatedImpact}`);
  }
  lines.push('');
  lines.push('**Query to execute:**');
  lines.push('```sql');
  lines.push(sql);
  lines.push('```');
  lines.push('');
  lines.push('To execute this query, call the tool again with `confirmed: true`');

  return lines.join('\n');
}

