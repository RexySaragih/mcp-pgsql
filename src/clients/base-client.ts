import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ClientConstants = {
  DEFAULT_TIMEOUT_MS: 30_000,
  ERROR_BODY_MAX: 300,
  HARD_MAX_ROWS: 500,
  DEFAULT_MAX_ROWS: 100,
  DISPLAY_MAX_ROWS: 100,
  CELL_TRUNCATE: 500,
  POOL_MAX: 10,
  CONNECT_TIMEOUT_MS: 5_000,
} as const;

/** Credentials come only from process.env (MCP host mcp.json env). Never load dotenv / repo .env. */
export function warnIfRepoDotEnvPresent(): void {
  try {
    if (existsSync(join(process.cwd(), '.env'))) {
      console.error(
        '[postgres-mcp] Ignoring .env in the working directory. Put PG* / DATABASE_URL in mcp.json mcpServers.*.env only.',
      );
    }
  } catch {
    // ignore filesystem errors
  }
}

export function sanitizeUpstreamBody(body: string): string {
  return body
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://[REDACTED]@')
    .replace(/password["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'password=[REDACTED]')
    .replace(/PGPASSWORD["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'PGPASSWORD=[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

export function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return sanitizeUpstreamBody(raw).slice(0, ClientConstants.ERROR_BODY_MAX);
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in mcp.json under mcpServers.<name>.env (not a repo .env file).`,
    );
  }
  return value;
}

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
