#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { closePool } from './clients/postgres-client.js';
import {
  sanitizeErrorMessage,
  warnIfRepoDotEnvPresent,
} from './clients/base-client.js';
import {
  describeTableTool,
  handleDescribeTable,
  handleListRelationships,
  handleListTables,
  listRelationshipsTool,
  listSchemas,
  listSchemasTool,
  listTablesTool,
} from './tools/schema.js';
import {
  handleReadQuery,
  handleSchemaQuery,
  handleTransactionQuery,
  handleWriteQuery,
  readQueryTool,
  schemaQueryTool,
  transactionQueryTool,
  writeQueryTool,
} from './tools/query.js';
import {
  handleRunTemplate,
  listTemplates,
  listTemplatesTool,
  runTemplateTool,
} from './tools/templates.js';
import {
  explainQueryTool,
  handleExplainQuery,
} from './tools/analysis.js';

const SERVER_NAME = 'postgres-mcp-server';
const SERVER_VERSION = '1.1.0';

type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

function logTool(
  tool: string,
  status: 'ok' | 'error',
  durationMs: number,
): void {
  console.error(
    `[mcp=${SERVER_NAME} tool=${tool} status=${status} duration_ms=${durationMs}]`,
  );
}

function textResult(text: string): ToolResponse {
  const isError = text.startsWith('Error:') || text.startsWith('**Transaction failed');
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function start(): Promise<void> {
  warnIfRepoDotEnvPresent();
  const tools = [
    listSchemasTool,
    listTablesTool,
    describeTableTool,
    listRelationshipsTool,
    readQueryTool,
    writeQueryTool,
    schemaQueryTool,
    transactionQueryTool,
    listTemplatesTool,
    runTemplateTool,
    explainQueryTool,
  ];

  const handlers: Record<string, (args: unknown) => Promise<string>> = {
    list_schemas: async () => listSchemas(),
    list_tables: (args) => handleListTables(args),
    describe_table: (args) => handleDescribeTable(args),
    list_relationships: (args) => handleListRelationships(args),
    read_query: (args) => handleReadQuery(args),
    write_query: (args) => handleWriteQuery(args),
    schema_query: (args) => handleSchemaQuery(args),
    transaction_query: (args) => handleTransactionQuery(args),
    list_templates: async () => listTemplates(),
    run_template: (args) => handleRunTemplate(args),
    explain_query: (args) => handleExplainQuery(args),
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const started = Date.now();
    try {
      const text = await handler(args ?? {});
      const result = textResult(text);
      logTool(name, result.isError ? 'error' : 'ok', Date.now() - started);
      return result;
    } catch (error: unknown) {
      logTool(name, 'error', Date.now() - started);
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        sanitizeErrorMessage(error),
      );
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`);

  const shutdown = async (): Promise<void> => {
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

start().catch((error: unknown) => {
  console.error('Fatal error:', sanitizeErrorMessage(error));
  process.exit(1);
});
