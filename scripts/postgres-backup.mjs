import { backupPostgres } from "../dist/postgres-backup.js";
const [directory, ...extra] = process.argv.slice(2);
if (!directory || extra.length || directory.startsWith("-")) {
  console.error("Usage: npm run backup:medicalcare -- <new-directory> (run on the authorized MedicalCareWeb Docker host)");
  process.exitCode = 1;
} else {
  try { console.log(JSON.stringify(await backupPostgres(directory))); }
  catch (error) { console.error(error instanceof Error ? error.message : "Backup failed"); process.exitCode = 1; }
}
