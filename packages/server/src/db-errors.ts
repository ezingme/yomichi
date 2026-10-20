/** Explains PostgreSQL failures in terms of the server's configuration. The
 * messages name settings and commands, never URLs, hosts or credentials. */
import { YomichiError } from "../../core/src/types.js";

type PgLike = Error & { code?: string; errno?: string };

export function databaseError(e: unknown): YomichiError | null {
  if (e instanceof YomichiError || !(e instanceof Error)) return null;
  const err = e as PgLike;
  const code = err.code ?? "";
  const message = err.message ?? "";
  if (
    ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH"].includes(code) ||
    /connection timeout|Connection terminated|connect ECONN/i.test(message)
  )
    return new YomichiError(
      "DATABASE_UNAVAILABLE",
      "Cannot connect to PostgreSQL. Check that it is running and reachable at the host and port in DATABASE_URL / ICHIRAN_DATABASE_URL.",
      503,
    );
  if (code === "28P01")
    return new YomichiError("DATABASE_AUTH", "PostgreSQL rejected the user name or password in the database URL.", 503);
  if (code === "28000")
    return new YomichiError(
      "DATABASE_AUTH",
      "PostgreSQL refused the connection (pg_hba.conf rules). A cloud database may require SSL: add ?sslmode=require to the database URL.",
      503,
    );
  if (code === "3D000")
    return new YomichiError("DATABASE_MISSING", "The database named in the database URL does not exist.", 503);
  if (code === "42P01") {
    const table = /relation "([^"]+)"/.exec(message)?.[1] ?? "";
    return table.startsWith("yomichi_")
      ? new YomichiError(
          "SCHEMA_MISSING",
          `Yomichi's tables are missing in the DATABASE_URL database (no "${table}"). Run: npm run db:migrate`,
          503,
        )
      : new YomichiError(
          "ICHIRAN_SCHEMA_MISSING",
          `Table "${table}" not found. ICHIRAN_DATABASE_URL must point to a restored Ichiran database.`,
          503,
        );
  }
  if (code === "57014")
    return new YomichiError("DATABASE_TIMEOUT", "A database query exceeded the statement timeout.", 503);
  if (/SSL|certificate/i.test(message))
    return new YomichiError(
      "DATABASE_SSL",
      "The PostgreSQL SSL handshake failed. Check sslmode in the database URL.",
      503,
    );
  return null;
}

/** A short description for logs and readiness output. */
export function describeError(e: unknown): { code: string; message: string } {
  const known = e instanceof YomichiError ? e : databaseError(e);
  if (known) return { code: known.code, message: known.message };
  return { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : String(e) };
}
