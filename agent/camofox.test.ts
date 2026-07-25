import { describe, expect, it, vi } from "vitest";
import { createTabWithRetry } from "./camofox.js";
describe("camofox retry", () => { it("wakes and retries at most three times", async () => { const create = vi.fn().mockRejectedValueOnce(new Error("503")).mockRejectedValueOnce(new Error("session_expired")).mockResolvedValue({ id: "a" }); const wake = vi.fn(); await expect(createTabWithRetry(create, "https://x", "s", wake)).resolves.toEqual({ id: "a" }); expect(create).toHaveBeenCalledTimes(3); expect(wake).toHaveBeenCalledTimes(2); }); });
