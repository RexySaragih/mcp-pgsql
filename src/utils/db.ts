/**
 * Compatibility shim — prefer getPostgresClient from clients/postgres-client.
 */
export {
  closePool,
  executeTransaction,
  getClient,
  getPostgresClient,
  query,
  PostgresClient,
} from '../clients/postgres-client.js';
