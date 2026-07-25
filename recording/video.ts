import { mkdir, writeFile, unlink, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
export async function captureScreenshot(tabId: string, userId: string, runDir: string, step: number, camofoxUrl: string, fetcher: typeof fetch = fetch): Promise<void> {
  await mkdir(runDir, { recursive: true }); const res = await fetcher(`${camofoxUrl}/tabs/${tabId}/screenshot?userId=${userId}`); if (!res.ok) throw new Error(`screenshot failed: ${res.status}`);
  await writeFile(join(runDir, `step-${String(step).padStart(4, "0")}.png`), Buffer.from(await res.arrayBuffer()));
}
export async function stitchVideo(runDir: string, outPath: string, execute: typeof execFileAsync = execFileAsync): Promise<boolean> {
  try { await execute("ffmpeg", ["-y", "-framerate", "1", "-pattern_type", "glob", "-i", "*.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", resolve(outPath)], { cwd: runDir }); const files = await readdir(runDir); await Promise.all(files.filter((f) => f.endsWith(".png")).map((f) => unlink(join(runDir, f)))); return true; } catch { return false; }
}
