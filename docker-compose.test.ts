import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Camoufox Compose readiness", () => {
	it("requires both browser readiness flags from the existing health endpoint", async () => {
		const compose = await readFile("docker-compose.yml", "utf8");
		expect(compose).toContain("http://127.0.0.1:9377/health");
		expect(compose).toContain("body.browserConnected === true");
		expect(compose).toContain("body.browserRunning === true");
		expect(compose).toContain("interval: 10s");
		expect(compose).toContain("timeout: 5s");
		expect(compose).toContain("retries: 12");
		expect(compose).toContain("start_period: 20s");
	});
});
