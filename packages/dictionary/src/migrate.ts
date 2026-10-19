import { createPool } from "./connection.js";
import { migrate } from "./schema.js";
const pool = createPool();
try {
  await migrate(pool);
  console.log("Schema ready");
} finally {
  await pool.end();
}
