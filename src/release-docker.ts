import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import type { ReleaseExecutor, WebsiteRelease } from "./release-manager.js";
const exec = promisify(execFile);
async function docker(args: string[], timeout = 15_000) { const { stdout } = await exec("docker", args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true }); return stdout.trim(); }
export function dockerReleaseExecutor(directory: string, releases: WebsiteRelease[], run = docker): ReleaseExecutor {
  if (!isAbsolute(directory)) throw new Error("Deployment directory must be absolute");
  async function current() {
    const states = await Promise.all(["medicalcare-app", "medicalcare-chat"].map(async (name) => {
      const raw = await run(["inspect", "--format", "{{.Image}}|{{.Config.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.Running}}", name]);
      const [id, reference, health, running] = raw.split("|"); return { id, reference, healthy: health === "healthy" && running === "true" };
    }));
    const match = (state: typeof states[number], image: string) => state.reference === image || state.id === image;
    const release = releases.find((item) => match(states[0]!, item.webImage) && match(states[1]!, item.chatImage));
    return { releaseId: release?.id ?? null, healthy: states.every((state) => state.healthy) };
  }
  return { current, async deploy(release) {
    for (const image of [release.webImage, release.chatImage]) {
      if (!image.startsWith("sha256:")) await run(["pull", image], 300_000);
      await run(["image", "inspect", "--format", "{{.Id}}", image]);
    }
    // Local deployment record remains on failure for controlled inspection; never include secrets.
    const work = await mkdtemp(join(tmpdir(), "medicalcare-release-"));
    const override = join(work, "release.json");
    await writeFile(override, JSON.stringify({ services: { medicalcare: { image: release.webImage }, chat: { image: release.chatImage } } }), { mode: 0o600 });
    await run(["compose", "--project-directory", directory, "-p", "deploy", "-f", join(directory, "compose.yaml"), "-f", override, "up", "-d", "--no-build", "--no-deps", "medicalcare", "chat"], 180_000);
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) { const state = await current(); if (state.releaseId === release.id && state.healthy) {
      await run(["exec", "shengren-nginx-1", "nginx", "-t"]);
      await run(["exec", "shengren-nginx-1", "nginx", "-s", "reload"]);
      return;
    } await new Promise((resolve) => setTimeout(resolve, 3000)); }
    throw new Error("Release health verification timed out");
  } };
}
