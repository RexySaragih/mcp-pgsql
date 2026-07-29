# TOOL_SPEC — postgres-mcp

## Goal
Let agents inspect PostgreSQL schemas and run queries with confirmation gates for writes/DDL/transactions.

## Non-goals
- MCP Resources / Prompts
- Aurora Data API / IAM auth (use AWS Labs MCP)

## Research summary
- Driver: `pg`
- Auth: PG* env or DATABASE_URL via mcp.json `env`
- Language: TypeScript | Transport: stdio
- MCP SDK: 1.30.0 (annotations)
- Residual risks: prompt injection via row data; shared bot role; transaction_query blast radius

## Identity & credentials
| Env var | Required | Purpose |
|---------|----------|---------|
| `DATABASE_URL` | no* | `postgres://user:pass@host:5432/db` |
| `PGHOST` | no | Default localhost |
| `PGPORT` | no | Default 5432 |
| `PGDATABASE` | yes* | DB name |
| `PGUSER` | yes* | User |
| `PGPASSWORD` | no | Password |
| `PGSSL` | no | `true` enables TLS |
| `PG_STATEMENT_TIMEOUT_MS` | no | Default 30000 |
| `PG_MAX_ROWS` | no | Default 100 (hard max 500) |

\* Or provided via DATABASE_URL. Secrets only in mcp.json `env`.

**Privilege scope:** prefer least-privilege role; separate read vs write bots when possible.

## v1 posture
- [ ] read-only only
- [x] writes included (separate `write_query` — strong confirmation)
- [x] destructive included (separate `schema_query` / `transaction_query` — strong confirmation)

## Tools
| Name | Annotations | Notes |
|------|-------------|-------|
| list_schemas | R | |
| list_tables | R | estimated rows; exact_counts optional |
| describe_table | R | |
| list_relationships | R | |
| read_query | R | SELECT only; locks need confirmed; LIMIT |
| write_query | W | separate tool; **confirmed:true** after strong preview |
| schema_query | D | separate tool; **confirmed:true** after strong preview |
| transaction_query | D | per-statement preview + **confirmed:true** |
| list_templates | R | |
| run_template | R | quoted identifiers |
| explain_query | R | analyze default false; ANALYZE needs confirmed |

## Security notes
- Comment-aware classification; WITH+DML not treated as SELECT
- Multi-statement rejected in read_query
- statement_timeout on pool connections
- Soft confirm for FOR UPDATE/SHARE
- Errors sanitized

## Verification
- [x] unit tests
- [x] smoke script
- [x] annotations
- [x] mcp-maker qc
