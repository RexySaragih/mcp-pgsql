# PostgreSQL MCP Server

A Model Context Protocol (MCP) server that enables AI-powered IDEs (Cursor, Kiro, etc.) to interact with your PostgreSQL database. Provides schema introspection, query execution, query templates, and performance analysis.

## Quick Start (npx — no install needed)

Add this to your MCP config and you're done. No cloning, no local setup:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@rexymayderio/postgres-mcp"],
      "env": {
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGDATABASE": "your_database_name",
        "PGUSER": "your_username",
        "PGPASSWORD": "your_password"
      }
    }
  }
}
```

The `-y` flag auto-confirms the package download so it runs without prompts.

**Config file locations:**

- **Kiro**: `~/.kiro/settings/mcp.json` or `.kiro/settings/mcp.json` (workspace-level)
- **Cursor**: `~/.cursor/mcp.json`

## Features

### Schema Introspection

- **list_schemas**: List all schemas in the database
- **list_tables**: List all tables with row counts and descriptions
- **describe_table**: Get detailed schema information (columns, types, constraints, indexes)
- **list_relationships**: Show foreign key relationships between tables

### Query Execution

- **read_query**: Execute SELECT queries (safe, no confirmation needed)
- **write_query**: Execute INSERT/UPDATE/DELETE (requires confirmation)
- **schema_query**: Execute CREATE/ALTER/DROP (requires confirmation)
- **transaction_query**: Execute multiple statements in a transaction

### Query Templates

- **list_templates**: Show available predefined query templates
- **run_template**: Execute a template with parameters (e.g., find_by_id, count_rows, search_text)

### Analysis

- **explain_query**: Run EXPLAIN ANALYZE with performance insights

## Safety Features

- **Write confirmation**: INSERT, UPDATE, DELETE operations require explicit confirmation
- **Schema change confirmation**: CREATE, ALTER, DROP operations require explicit confirmation
- **Query analysis**: Automatic detection of query types and risk levels
- **Preview mode**: See what will happen before executing dangerous queries

## Environment Variables

All connection details are passed via the `env` field in your MCP config:

| Variable     | Required | Default     | Description       |
| ------------ | -------- | ----------- | ----------------- |
| `PGHOST`     | Yes      | `localhost` | Database host     |
| `PGPORT`     | No       | `5432`      | Database port     |
| `PGDATABASE` | Yes      | —           | Database name     |
| `PGUSER`     | Yes      | —           | Database user     |
| `PGPASSWORD` | Yes      | —           | Database password |

## Local Development

If you want to modify or contribute:

```bash
git clone <repo-url>
cd postgres-mcp-server
npm install
npm run build
```

Then point your MCP config to the local build:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["/absolute/path/to/postgres-mcp-server/dist/index.js"],
      "env": {
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGDATABASE": "your_database_name",
        "PGUSER": "your_username",
        "PGPASSWORD": "your_password"
      }
    }
  }
}
```

## Usage Examples

### List all tables

```
Use the list_tables tool to see all tables in the database
```

### Describe a table

```
Use describe_table with table="users" to see the schema
```

### Execute a SELECT query

```
Use read_query with sql="SELECT * FROM users LIMIT 10"
```

### Execute a write query (with confirmation)

```
First call: write_query with sql="UPDATE users SET status='active' WHERE id=1"
Second call: write_query with sql="UPDATE users SET status='active' WHERE id=1" and confirmed=true
```

### Analyze query performance

```
Use explain_query with sql="SELECT * FROM users WHERE email='test@example.com'"
```

### Use a template

```
Use run_template with template_id="find_by_id" and parameters={"table": "users", "id": 1}
```

## Available Query Templates

1. **find_by_id**: Find a row by its primary key ID
2. **count_rows**: Count total rows in a table
3. **find_recent**: Find the most recent N rows
4. **search_text**: Search for text in a column (case-insensitive)
5. **get_table_stats**: Get statistics about a table
6. **find_related**: Find rows in a related table using foreign keys

## Project Structure

```
postgres-mcp-server/
├── src/
│   ├── index.ts           # Main MCP server entry point
│   ├── tools/
│   │   ├── schema.ts      # Schema introspection tools
│   │   ├── query.ts       # Query execution tools
│   │   ├── templates.ts   # Predefined query templates
│   │   └── analysis.ts    # Query explain/analysis
│   └── utils/
│       ├── db.ts          # Database connection pool
│       └── safety.ts      # Write confirmation logic
├── package.json
├── tsconfig.json
└── README.md
```

## Requirements

- Node.js 18+
- PostgreSQL database

## License

MIT
