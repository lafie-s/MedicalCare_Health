import { createSnapshot, restoreSnapshot } from "../dist/database-snapshot.js";

const [operation, source, destination, ...extra] = process.argv.slice(2);
if (!["backup", "restore"].includes(operation) || !source || !destination || extra.length) {
  console.error("Usage: npm run db:snapshot -- backup <database-file> <new-directory> | restore <backup-directory> <new-directory>");
  process.exitCode = 1;
} else {
  try {
    const result = await (operation === "backup" ? createSnapshot(source, destination) : restoreSnapshot(source, destination));
    console.log(JSON.stringify({ operation, status: "verified", ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Snapshot failed");
    process.exitCode = 1;
  }
}
