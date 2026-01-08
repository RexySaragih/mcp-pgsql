import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { query } from '../utils/db.js';
import { analyzeQuery } from '../utils/safety.js';

export const explainQueryTool: Tool = {
  name: 'explain_query',
  description: 'Run EXPLAIN ANALYZE on a query to analyze its performance, execution plan, and resource usage',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL query to analyze (should be a SELECT query)',
      },
      analyze: {
        type: 'boolean',
        description: 'Whether to run ANALYZE (actually executes the query). Defaults to true.',
        default: true,
      },
      format: {
        type: 'string',
        description: 'Output format: text, json, xml, or yaml. Defaults to text.',
        enum: ['text', 'json', 'xml', 'yaml'],
        default: 'text',
      },
    },
    required: ['sql'],
  },
};

export async function explainQuery(
  sql: string,
  analyze: boolean = true,
  format: 'text' | 'json' | 'xml' | 'yaml' = 'text'
): Promise<string> {
  const queryAnalysis = analyzeQuery(sql);
  
  // Only allow SELECT queries for EXPLAIN
  if (!queryAnalysis.isReadOnly) {
    return `Error: EXPLAIN can only be used with SELECT queries. For write operations, use write_query or schema_query.`;
  }

  // Build EXPLAIN query
  let explainSql = 'EXPLAIN';
  
  if (analyze) {
    explainSql += ' ANALYZE';
  }
  
  if (format !== 'text') {
    explainSql += ` (FORMAT ${format.toUpperCase()})`;
  }
  
  explainSql += ` ${sql}`;

  try {
    const result = await query(explainSql);
    
    const lines: string[] = [
      `**Query Execution Plan**\n`,
      `**Query:**\n\`\`\`sql\n${sql}\n\`\`\`\n`,
    ];

    if (format === 'json') {
      // Parse JSON output
      try {
        const plan = JSON.parse(result.rows[0]['QUERY PLAN']);
        lines.push('**Execution Plan (JSON):**');
        lines.push('```json');
        lines.push(JSON.stringify(plan, null, 2));
        lines.push('```');
        
        // Extract key metrics if available
        if (plan[0] && plan[0].Plan) {
          const planNode = plan[0].Plan;
          lines.push('\n**Key Metrics:**');
          if (planNode['Execution Time']) {
            lines.push(`- Execution Time: ${planNode['Execution Time']} ms`);
          }
          if (planNode['Planning Time']) {
            lines.push(`- Planning Time: ${planNode['Planning Time']} ms`);
          }
          if (planNode['Total Cost']) {
            lines.push(`- Total Cost: ${planNode['Total Cost']}`);
          }
        }
      } catch (e) {
        // If JSON parsing fails, just show raw output
        lines.push('**Execution Plan:**');
        lines.push('```');
        for (const row of result.rows) {
          lines.push(row['QUERY PLAN']);
        }
        lines.push('```');
      }
    } else {
      // Text format (default)
      lines.push('**Execution Plan:**');
      lines.push('```');
      for (const row of result.rows) {
        lines.push(row['QUERY PLAN']);
      }
      lines.push('```');
      
      // Try to extract timing information from text output
      const planText = result.rows.map((r: any) => r['QUERY PLAN']).join('\n');
      const executionTimeMatch = planText.match(/Execution Time: ([\d.]+) ms/);
      const planningTimeMatch = planText.match(/Planning Time: ([\d.]+) ms/);
      
      if (executionTimeMatch || planningTimeMatch) {
        lines.push('\n**Performance Metrics:**');
        if (planningTimeMatch) {
          lines.push(`- Planning Time: ${planningTimeMatch[1]} ms`);
        }
        if (executionTimeMatch) {
          lines.push(`- Execution Time: ${executionTimeMatch[1]} ms`);
        }
      }
    }

    // Add performance insights
    lines.push('\n**Performance Insights:**');
    
    const planText = result.rows.map((r: any) => r['QUERY PLAN']).join('\n');
    
    const insights: string[] = [];
    
    // Check for sequential scans
    if (planText.includes('Seq Scan')) {
      insights.push('⚠️ Query uses sequential scan - consider adding indexes');
    }
    
    // Check for index usage
    if (planText.includes('Index Scan') || planText.includes('Index Only Scan')) {
      insights.push('✅ Query uses indexes efficiently');
    }
    
    // Check for nested loops
    if (planText.match(/Nested Loop.*rows=\d+/)) {
      insights.push('⚠️ Query uses nested loops - may be slow on large datasets');
    }
    
    // Check for hash joins
    if (planText.includes('Hash Join')) {
      insights.push('ℹ️ Query uses hash joins - good for large datasets');
    }
    
    // Check for sort operations
    if (planText.includes('Sort')) {
      insights.push('ℹ️ Query includes sorting operation');
    }
    
    // Check for high cost
    const costMatch = planText.match(/cost=([\d.]+)\.\.([\d.]+)/);
    if (costMatch) {
      const maxCost = parseFloat(costMatch[2]);
      if (maxCost > 1000) {
        insights.push('⚠️ High query cost detected - query may be slow');
      }
    }
    
    if (insights.length === 0) {
      insights.push('✅ No obvious performance issues detected');
    }
    
    lines.push(insights.join('\n'));

    return lines.join('\n');
  } catch (error: any) {
    return `Error analyzing query: ${error.message}\n\n**SQL attempted:**\n\`\`\`sql\n${explainSql}\n\`\`\``;
  }
}

