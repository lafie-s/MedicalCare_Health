import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, open, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const tables = ["services", "probe_runs", "alert_rules", "alert_events", "maintenance_windows", "audit_events", "sessions"];
async function digest(path: string) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
function inspect(db: DatabaseSync) {
  const check = db.prepare("PRAGMA integrity_check").all();
  if (check.length !== 1 || check[0]!.integrity_check !== "ok") throw new Error("Database integrity check failed");
  const counts = Object.fromEntries(tables.map((name) => [name, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()!.count)]));
  for (const table of ["failure_logs", "release_tasks", "maintenance_access", "maintenance_access_changes"]) {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);
  }
  return counts;
}
async function sync(path: string) { const file = await open(path, "r+"); try { await file.sync(); } finally { await file.close(); } }

// Destination must be new. Failed artifacts remain for inspection, without a success manifest.
export async function createSnapshot(source: string, destination: string, clearSessions = false) {
  source = resolve(source); destination = resolve(destination);
  if (!(await stat(source)).isFile()) throw new Error("Source must be a database file");
  const db = new DatabaseSync(source, { readOnly: true });
  const output = join(destination, "state.sqlite");
  try {
    inspect(db);
    await mkdir(destination, { mode: 0o700 });
    db.prepare("VACUUM INTO ?").run(output);
  } finally { db.close(); }
  const snapshot = new DatabaseSync(output);
  let counts: Record<string, number>;
  try {
    if (clearSessions) {
      snapshot.exec("BEGIN IMMEDIATE");
      try {
        snapshot.exec("DELETE FROM sessions");
        snapshot.prepare("INSERT INTO audit_events(actor,action,request_id,created_at) VALUES (?,?,?,?)").run("system:restore", "database.restored", "local-restore", Date.now());
        snapshot.exec("COMMIT");
      } catch (error) { snapshot.exec("ROLLBACK"); throw error; }
    }
    counts = inspect(snapshot);
    snapshot.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { snapshot.close(); }
  await sync(output);
  const manifest = { version: 1, createdAt: new Date().toISOString(), sha256: await digest(output), counts, sessionsCleared: clearSessions };
  const manifestPath = join(destination, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await sync(manifestPath);
  return manifest;
}

export async function restoreSnapshot(sourceDirectory: string, destination: string) {
  const source = join(resolve(sourceDirectory), "state.sqlite");
  const manifest = JSON.parse(await readFile(join(sourceDirectory, "manifest.json"), "utf8")) as { version?: number; sha256?: string };
  if (manifest.version !== 1 || !manifest.sha256 || manifest.sha256 !== await digest(source)) throw new Error("Backup checksum or manifest is invalid");
  return createSnapshot(source, destination, true);
}
