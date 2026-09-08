import { z } from "zod";
import { ReleaseConflict, type ReleaseStore, type ReleaseTask } from "./release-store.js";
const image = z.string().regex(/^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64})$/);
export const releaseConfigSchema = z.object({ serviceId: z.uuid(), deploymentDirectory: z.string().min(1), releases: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/), name: z.string().min(1).max(80), notes: z.string().max(1000), publishedAt: z.iso.datetime(), databaseCompatible: z.literal(true), webImage: image, chatImage: image }).strict()).min(1).max(20) }).strict();
export type WebsiteRelease = z.infer<typeof releaseConfigSchema>["releases"][number];
export type ReleaseExecutor = { current: () => Promise<{ releaseId: string | null; healthy: boolean }>; deploy: (release: WebsiteRelease) => Promise<void> };
export class ReleaseManager {
  private pending = new Set<Promise<void>>();
  constructor(readonly serviceId: string, readonly releases: WebsiteRelease[], readonly mode: "demo" | "docker", private readonly store: ReleaseStore, private readonly executor: ReleaseExecutor) {
    if (new Set(releases.map((r) => r.id)).size !== releases.length) throw new Error("Duplicate release ID");
    if (new Set(releases.map((r) => `${r.webImage}|${r.chatImage}`)).size !== releases.length) throw new Error("Duplicate release image pair");
  }
  async snapshot() {
    const current = await this.executor.current();
    return { ...current, mode: this.mode, releases: this.releases.map(({ id, name, notes, publishedAt }) => ({ id, name, notes, publishedAt })), previousReleaseId: this.store.previous(this.serviceId), active: this.store.active(this.serviceId), tasks: this.store.list(this.serviceId), asOf: Date.now() };
  }
  async start(input: { id: string; to: string; expected: string; action: ReleaseTask["action"]; reason: string; backupReference: string }, actor: string): Promise<ReleaseTask> {
    const existing = this.store.get(input.id);
    if (existing) {
      if (existing.serviceId === this.serviceId && existing.actor === actor && existing.to === input.to && existing.from === input.expected && existing.action === input.action && existing.reason === input.reason && existing.backupReference === input.backupReference) return existing;
      throw new ReleaseConflict("相同请求标识不能用于不同的更新内容");
    }
    const release = this.releases.find((item) => item.id === input.to);
    if (!release || input.to === input.expected || input.action === "rollback" && this.store.previous(this.serviceId) !== input.to) throw new ReleaseConflict("目标版本未批准、与当前相同或不是可回退版本");
    const current = await this.executor.current();
    if (!current.healthy || current.releaseId !== input.expected) throw new ReleaseConflict("当前版本或健康状态已变化，请刷新核对");
    if (this.store.get(input.id)) return this.start(input, actor);
    const task = this.store.create({ id: input.id, serviceId: this.serviceId, from: input.expected, to: input.to, action: input.action, actor, reason: input.reason, backupReference: input.backupReference, createdAt: Date.now(), finishedAt: null, status: "running", message: "执行中：准备已批准镜像、切换应用并验证健康状态" });
    const work = this.execute(task, release); this.pending.add(work); void work.finally(() => this.pending.delete(work));
    return task;
  }
  private async execute(task: ReleaseTask, release: WebsiteRelease) {
    try {
      await this.executor.deploy(release);
      const current = await this.executor.current();
      if (current.releaseId !== release.id || !current.healthy) throw new Error("Post-deployment verification failed");
      this.store.finish(task.id, "succeeded", "目标镜像和网站/接口健康检查通过");
    } catch {
      try { this.store.finish(task.id, "unknown", "执行失败或超时，实际结果待核对；暂停新任务，避免重复发布"); } catch { /* The running record persists and locks further operations. */ }
    }
  }
  async reconcile(actor: string) {
    const task = this.store.active(this.serviceId);
    if (!task || task.status !== "unknown") throw new ReleaseConflict("没有待核对的任务");
    const current = await this.executor.current();
    if (!current.healthy || ![task.from, task.to].includes(current.releaseId ?? "")) throw new ReleaseConflict("仍未确认原版本或目标版本健康运行，须由部署人员排查");
    return this.store.finish(task.id, current.releaseId === task.to ? "succeeded" : "failed", current.releaseId === task.to ? "核对完成：目标版本健康运行" : "核对完成：原版本健康运行，更新未生效", actor);
  }
  async close() { await Promise.allSettled(this.pending); }
}
