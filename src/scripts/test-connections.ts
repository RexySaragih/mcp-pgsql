function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function mask(value: string): string {
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

async function main(): Promise<void> {
  const { getPostgresClient, closePool } = await import(
    '../clients/postgres-client.js'
  );

  const url = optionalEnv('DATABASE_URL');
  if (url) {
    console.error(`Smoke: DATABASE_URL=${mask(url)}`);
  } else {
    console.error(
      `Smoke: host=${optionalEnv('PGHOST') ?? 'localhost'} db=${optionalEnv('PGDATABASE') ?? '(missing)'} user=${optionalEnv('PGUSER') ?? '(missing)'}`,
    );
  }

  const client = getPostgresClient();
  try {
    await client.ping();
    console.error('OK: connected');
  } finally {
    await closePool();
  }
}

main().catch((error: unknown) => {
  console.error('FAIL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
