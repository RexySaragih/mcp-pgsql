#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// Import tools
import {
  listSchemasTool,
  listSchemas,
  listTablesTool,
  listTables,
  describeTableTool,
  describeTable,
  listRelationshipsTool,
  listRelationships,
} from './tools/schema.js';

import {
  readQueryTool,
  readQuery,
  writeQueryTool,
  writeQuery,
  schemaQueryTool,
  schemaQuery,
  transactionQueryTool,
  transactionQuery,
} from './tools/query.js';

import {
  listTemplatesTool,
  listTemplates,
  runTemplateTool,
  runTemplate,
} from './tools/templates.js';

import {
  explainQueryTool,
  explainQuery,
} from './tools/analysis.js';

import { closePool } from './utils/db.js';

// Create server instance
const server = new Server(
  {
    name: 'postgres-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register all tools
const tools = [
  // Schema introspection
  listSchemasTool,
  listTablesTool,
  describeTableTool,
  listRelationshipsTool,
  
  // Query execution
  readQueryTool,
  writeQueryTool,
  schemaQueryTool,
  transactionQueryTool,
  
  // Templates
  listTemplatesTool,
  runTemplateTool,
  
  // Analysis
  explainQueryTool,
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Schema introspection
      case 'list_schemas':
        return {
          content: [
            {
              type: 'text',
              text: await listSchemas(),
            },
          ],
        };

      case 'list_tables':
        return {
          content: [
            {
              type: 'text',
              text: await listTables(args?.schema as string | undefined),
            },
          ],
        };

      case 'describe_table':
        return {
          content: [
            {
              type: 'text',
              text: await describeTable(
                args?.schema as string | undefined,
                args?.table as string
              ),
            },
          ],
        };

      case 'list_relationships':
        return {
          content: [
            {
              type: 'text',
              text: await listRelationships(
                args?.schema as string | undefined,
                args?.table as string | undefined
              ),
            },
          ],
        };

      // Query execution
      case 'read_query':
        return {
          content: [
            {
              type: 'text',
              text: await readQuery(args?.sql as string),
            },
          ],
        };

      case 'write_query':
        return {
          content: [
            {
              type: 'text',
              text: await writeQuery(
                args?.sql as string,
                args?.confirmed as boolean | undefined
              ),
            },
          ],
        };

      case 'schema_query':
        return {
          content: [
            {
              type: 'text',
              text: await schemaQuery(
                args?.sql as string,
                args?.confirmed as boolean | undefined
              ),
            },
          ],
        };

      case 'transaction_query':
        return {
          content: [
            {
              type: 'text',
              text: await transactionQuery(
                args?.sql as string,
                args?.confirmed as boolean | undefined
              ),
            },
          ],
        };

      // Templates
      case 'list_templates':
        return {
          content: [
            {
              type: 'text',
              text: await listTemplates(),
            },
          ],
        };

      case 'run_template':
        return {
          content: [
            {
              type: 'text',
              text: await runTemplate(
                args?.template_id as string,
                args?.parameters as Record<string, any>
              ),
            },
          ],
        };

      // Analysis
      case 'explain_query':
        return {
          content: [
            {
              type: 'text',
              text: await explainQuery(
                args?.sql as string,
                args?.analyze as boolean | undefined,
                args?.format as 'text' | 'json' | 'xml' | 'yaml' | undefined
              ),
            },
          ],
        };

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Error executing tool ${name}: ${error.message}`
    );
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('PostgreSQL MCP server running on stdio');

  // Cleanup on exit
  process.on('SIGINT', async () => {
    await closePool();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await closePool();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});

