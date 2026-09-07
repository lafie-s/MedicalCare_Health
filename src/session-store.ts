import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class SessionStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Session key must contain 32 bytes");
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  private encrypt(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  private decrypt(value: string) {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
  private transaction(action: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try { action(); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  audit(actor: string, action: string, requestId: string) {
    this.db.prepare("INSERT INTO audit_events (actor, action, request_id, created_at) VALUES (?, ?, ?, ?)").run(actor, action, requestId, Date.now());
  }
  create(userId: string, upstreamToken: string, requestId: string, now = Date.now()) {
    const id = randomBytes(32).toString("base64url");
    const expiresAt = now + 15 * 60_000;
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
      // Cap concurrent sessions per operator; a new exchange replaces the old one.
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      this.db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(hash(id), userId, this.encrypt(upstreamToken), expiresAt);
      this.audit(userId, "session.created", requestId);
    });
    return { id, expiresAt };
  }
  find(id: string, now = Date.now()) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const row = this.db.prepare("SELECT user_id, token, expires_at FROM sessions WHERE id = ?").get(hash(id));
    if (!row) return null;
    if (Number(row.expires_at) <= now) { this.db.prepare("DELETE FROM sessions WHERE id = ?").run(hash(id)); return null; }
    return { userId: String(row.user_id), token: this.decrypt(String(row.token)), expiresAt: Number(row.expires_at) };
  }
  revoke(id: string, requestId: string) {
    this.transaction(() => {
      const row = this.db.prepare("SELECT user_id FROM sessions WHERE id = ?").get(hash(id));
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(hash(id));
      if (row) this.audit(String(row.user_id), "session.revoked", requestId);
    });
  }
  ready() { return this.db.prepare("SELECT 1 AS ok").get()?.ok === 1; }
  close() { this.db.close(); }
}
