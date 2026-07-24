import { mkdir, writeFile, unlink, readdir } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { join, resolve } from "path";
import pino from "pino";

const execAsync = promisify(exec);
const logger = pino({ level: "info" });
const CAMOFOX_URL = process.env.CAMOFOX_URL ?? "http://camofox-browser:9377";

export async function captureScreenshot(tabId: string, userId: string, runDir: string, step: number): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const stepPadded = String(step).padStart(4, "0");
  const res = await fetch(`${CAMOFOX_URL}/tabs/${tabId}/screenshot?userId=${userId}`);
  if (!res.ok) throw new Error(`screenshot failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(runDir, `step-${stepPadded}.png`), buf);
}

export async function stitchVideo(runDir: string, outPath: string): Promise<boolean> {
  const absOutPath = resolve(outPath);
  try {
    await execAsync(
      `ffmpeg -y -framerate 1 -pattern_type glob -i '*.png' -c:v libx264 -pix_fmt yuv420p "${absOutPath}"`,
      { cwd: runDir },
    );
    // Delete PNGs after successful stitch
    const files = await readdir(runDir);
    await Promise.all(
      files.filter((f) => f.endsWith(".png")).map((f) => unlink(join(runDir, f))),
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("No such file") || msg.includes("command not found")) {
      logger.warn("ffmpeg not found — skipping video production");
    } else {
      logger.warn({ err: msg }, "ffmpeg stitch failed");
    }
    return false;
  }
}
