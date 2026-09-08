import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { backupPostgres, dumpArguments, listArguments } from "../src/postgres-backup.js";

test("PostgreSQL backup preserves binary output, checks archive and publishes manifest last", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mc-pg-backup-"));
  t.after(async () => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "mc-pg-backup-")); await rm(root, { recursive: true, force: true }); });
  const bytes = Buffer.concat([Buffer.from("PGDMP"), Buffer.from([0, 255, 128, 10])]);
  let calls = 0;
  const manifest = await backupPostgres(join(root, "ok"), async (command) => {
    calls++;
    if (command.output) { assert.deepEqual(command.args, dumpArguments); await command.output.write(bytes); }
    else { assert.deepEqual(command.args, listArguments); assert.ok(command.input); const read = Buffer.alloc(bytes.length); await command.input.read(read, 0, read.length, null); assert.deepEqual(read, bytes); }
  });
  assert.equal(calls, 2); assert.equal(manifest.restoreVerified, false); assert.equal(manifest.sha256.length, 64);
  assert.deepEqual(await readFile(join(root, "ok", "medicalcare.dump")), bytes);
  await assert.rejects(backupPostgres(join(root, "ok"), async () => { throw new Error("must not execute"); }), /EEXIST/);
  for (const failure of ["dump", "header", "list"]) {
    const directory = join(root, failure);
    await assert.rejects(backupPostgres(directory, async (command) => {
      if (failure === "dump" || !command.output) throw new Error("injected failure");
      await command.output.write(failure === "header" ? Buffer.from("broken") : bytes);
    }));
    await assert.rejects(stat(join(directory, "manifest.json")), /ENOENT/);
  }
});
