import pg from "pg";
export function createPool(
  url = process.env.DATABASE_URL,
  opts: { readOnly?: boolean } = {},
) {
  if (!url) throw new Error("DATABASE_URL is required. See .env.example.");
  return new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    // reject writes at the server, e.g. for a database read in place
    ...(opts.readOnly
      ? { options: "-c default_transaction_read_only=on" }
      : {}),
  });
}
