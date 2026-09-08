import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FileHandle } from "node:fs/promises";

type Command = { args: string[]; input?: FileHandle; output?: FileHandle };
export type BackupRunner = (command: Command) => Promise<void>;
// Fixed deployment target from MedicalCareWeb/deploy/compose.yaml; no shell or URL input.
export const dumpArguments = ["exec", "medicalcare-postgres", "pg_dump", "--username=medicalcare", "--dbname=medicalcare_chat", "--format=custom", "--no-password", "--lock-wait-timeout=10s"];
export const listArguments = ["exec", "-i", "medicalcare-postgres", "pg_restore", "--list"];
export const runDocker: BackupRunner = (command) => new Promise((resolve, reject) => {
  const child = spawn("docker", command.args, { shell: false, windowsHide: true, stdio: [command.input?.fd ?? "ignore", command.output?.fd ?? "ignore", "ignore"] });
  let expired = false;
  const timer = setTimeout(() => { expired = true; child.kill(); }, 30 * 60_000);
  child.once("error", () => { clearTimeout(timer); reject(new Error("Docker could not start; check installation and permissions")); });
  child.once("close", (code) => { clearTimeout(timer); if (code === 0 && !expired) resolve(); else reject(new Error(expired ? "Backup command timed out; inspect container for a remaining pg_dump process" : "Docker backup command failed; inspect deployment locally (raw database errors are not logged)")); });
});

export async function backupPostgres(directory: string, run: BackupRunner = runDocker) {
  directory = resolve(directory);
  await mkdir(directory, { mode: 0o700 }); // exclusive: never overwrite any previous artifact
  const path = join(directory, "medicalcare.dump");
  const output = await open(path, "wx", 0o600);
  try { await run({ args: [...dumpArguments], output }); await output.sync(); } finally { await output.close(); }
  const input = await open(path, "r");
  try {
    const header = Buffer.alloc(5); await input.read(header, 0, 5, 0);
    if (header.toString("ascii") !== "PGDMP") throw new Error("Invalid PostgreSQL custom archive header");
    await run({ args: [...listArguments], input });
  } finally { await input.close(); }
  const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk);
  const manifest = { version: 1, engine: "postgresql", database: "medicalcare_chat", container: "medicalcare-postgres", createdAt: new Date().toISOString(), format: "custom", sha256: hash.digest("hex"), archiveListChecked: true, restoreVerified: false };
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const file = await open(manifestPath, "r+"); try { await file.sync(); } finally { await file.close(); }
  return manifest;
}
