import pg from "pg";
export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required. See .env.example.");
  return new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
  });
}
