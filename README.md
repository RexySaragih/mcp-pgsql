# PostgreSQL MCP Server for Cursor

A Model Context Protocol (MCP) server that enables Cursor to interact with your PostgreSQL database. This server provides comprehensive database tools including schema introspection, query execution, query templates, and performance analysis.

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

### Query Templates
- **list_templates**: Show available predefined query templates
- **run_template**: Execute a template with parameters (e.g., find_by_id, count_rows, search_text)

### Analysis
- **explain_query**: Run EXPLAIN ANALYZE with performance insights

## Safety Features

The server includes built-in safety mechanisms:
- **Write confirmation**: All INSERT, UPDATE, DELETE operations require explicit confirmation
- **Schema change confirmation**: All CREATE, ALTER, DROP operations require explicit confirmation
- **Query analysis**: Automatic detection of query types and risk levels
- **Preview mode**: See what will happen before executing dangerous queries

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Build the TypeScript code:
```bash
npm run build
```

4. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

5. Edit `.env` with your PostgreSQL connection details:
```
PGHOST=localhost
PGPORT=5432
PGDATABASE=your_database_name
PGUSER=your_username
PGPASSWORD=your_password
```

## Cursor Integration

Add the server to your Cursor MCP configuration:

1. Open or create `~/.cursor/mcp.json` (or `%APPDATA%\Cursor\mcp.json` on Windows)

2. Find your Node.js path:
   - **If using nvm**: Run `which node` to get the full path (e.g., `~/.nvm/versions/node/v22.17.0/bin/node`)
   - **If using Homebrew**: Run `which node` to get the full path (e.g., `/opt/homebrew/bin/node`)
   - **Note**: On macOS, if you encounter ICU4C library errors with Homebrew Node.js, use nvm Node.js instead

3. Add the following configuration:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "/path/to/your/node",
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

**Important**: 
- Replace `/path/to/your/node` with the full path to your Node.js executable (use `which node` to find it)
- Replace `/absolute/path/to/postgres-mcp-server` with the actual absolute path to your project directory
- **macOS users**: If you see `dyld: Library not loaded: libicui18n.73.dylib` errors, use nvm Node.js instead of Homebrew Node.js

4. Restart Cursor completely (quit and reopen) for the changes to take effect.

### Alternative: Using .env File

Instead of hardcoding credentials in `mcp.json`, you can use a `.env` file in your project directory. This is more secure and keeps credentials out of your configuration file.

1. Create a `.env` file in the project root (if you haven't already):
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your PostgreSQL connection details:
   ```env
   PGHOST=localhost
   PGPORT=5432
   PGDATABASE=your_database_name
   PGUSER=your_username
   PGPASSWORD=your_password
   ```

3. Update your `mcp.json` to omit the `env` section:
   ```json
   {
     "mcpServers": {
       "postgres": {
         "command": "/path/to/your/node",
         "args": ["/absolute/path/to/postgres-mcp-server/dist/index.js"]
       }
     }
   }
   ```

   The server will automatically read environment variables from the `.env` file in the project directory.

**Note**: Make sure your `.env` file is in the same directory as `dist/index.js` (the project root), and never commit `.env` files to version control.

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

## Development

### Build
```bash
npm run build
```

### Watch mode (for development)
```bash
npm run dev
```

### Run directly
```bash
npm start
```

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
├── .env.example
└── README.md
```

## Requirements

- Node.js 18+ 
- PostgreSQL database
- Cursor IDE with MCP support

## Troubleshooting

### ICU4C Library Error on macOS

If you encounter an error like:
```
dyld: Library not loaded: /opt/homebrew/opt/icu4c/lib/libicui18n.73.dylib
```

This happens when Homebrew Node.js is compiled against a different ICU4C version than what's installed. **Solution**: Use nvm Node.js instead:

1. Install nvm if you haven't: https://github.com/nvm-sh/nvm
2. Install Node.js via nvm: `nvm install 18` (or any version 18+)
3. Use the nvm Node.js path in your MCP configuration:
   ```bash
   which node  # This will show the nvm path
   ```
4. Update `~/.cursor/mcp.json` to use the nvm Node.js path instead of `/opt/homebrew/bin/node`

## License

MIT

