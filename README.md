# PostgreSQL MCP Server

MCP server for PostgreSQL: schema introspection, SELECT (with lock confirmation), gated writes/DDL/transactions, templates, and EXPLAIN.

## Quick Start (npx)

Secrets belong in agent **mcp.json `env`** (mcpServers.*.env) — **not project `.env`**. Do not create a project `.env` for runtime credentials.

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
        "PGPASSWORD": "your-password"
      }
    }
  }
}
```

Optional: `DATABASE_URL`, `PGSSL=true`, `PG_STATEMENT_TIMEOUT_MS`, `PG_MAX_ROWS`.

**Privilege scope:** use a least-privilege Postgres role. Prefer a SELECT-only user for read-heavy agents; use a separate write role when writes are required.

## Tools

| Tool | Notes |
|------|-------|
| `list_schemas` | Non-system schemas |
| `list_tables` | Estimated rows (`reltuples`); `exact_counts=true` for COUNT(*) |
| `describe_table` | Columns, PK, FKs, indexes |
| `list_relationships` | FK graph |
| `read_query` | SELECT only; LIMIT-capped; `FOR UPDATE`/`FOR SHARE` need `confirmed` |
| `write_query` | INSERT/UPDATE/DELETE — **strong confirm** (separate from reads/DDL) |
| `schema_query` | CREATE/ALTER/DROP — **strong confirm** (separate from DML) |
| `transaction_query` | Multi-statement — per-statement risk preview + **strong confirm** |
| `list_templates` / `run_template` | Safe parameterized helpers |
| `explain_query` | Plan-only by default; `analyze=true` needs `confirmed` |

Writes are **separate tools** from reads. Agents must not use `read_query` for DML/DDL.

### Strong confirmation

MCP has no native UI modal. Mutating tools return an impact preview and **do not execute** until called again with the same `sql` and `confirmed: true`.

Client operators should require approval on `write_query`, `schema_query`, and `transaction_query` (`destructiveHint` / non-readOnly).

## Safety

- Comment-aware SQL classification (`WITH … INSERT` is not read-only)
- Multi-statement blocked on `read_query`
- `statement_timeout` on connections
- Confirmation previews explain impact before mutating or locking
- Errors redacted (no password/URL dumps)

## Local development

```bash
npm install
npm test
npm run build
# Smoke (pass env inline — never create a repo .env):
# PGHOST=… PGDATABASE=… PGUSER=… PGPASSWORD=… npm run test:connections
```

## Risks

- Row content is untrusted (prompt injection)
- `transaction_query` can still run privileged SQL after confirmation — use a scoped DB role
- Shared bot identity across sessions

## Deferred

- Aurora IAM / RDS Data API
- Splitting read vs write into separate MCP packages
