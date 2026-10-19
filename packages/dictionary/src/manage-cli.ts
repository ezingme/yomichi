import { readFile } from "node:fs/promises";
import { createPool } from "./connection.js";
import { listDatasets, activateDataset } from "./maintenance.js";
import { applyEntryOverlays, type EntryOverlay } from "./overlays.js";
const [command, id, file, version, source] = process.argv.slice(2);
if (
  !["list", "activate", "overlay"].includes(command) ||
  (command === "activate" && !id) ||
  (command === "overlay" && (!id || !file || !version || !source))
) {
  console.error(
    "Usage: db:manage -- list | activate DATASET_ID | overlay BASE_ID FILE.json VERSION SOURCE",
  );
  process.exit(1);
}
const pool = createPool();
const connection = await pool.connect();
try {
  if (command === "list")
    console.log(JSON.stringify(await listDatasets(connection), null, 2));
  else if (command === "activate") {
    await activateDataset(connection, id);
    console.log(JSON.stringify({ active: id }));
  } else {
    const overlays: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(overlays))
      throw new Error("Overlay file must contain an array");
    console.log(
      JSON.stringify(
        await applyEntryOverlays(connection, id, overlays as EntryOverlay[], {
          version,
          source,
        }),
      ),
    );
  }
} finally {
  connection.release();
  await pool.end();
}
