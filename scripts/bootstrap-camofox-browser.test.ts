import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);
const scraperDir = process.cwd();
const sourceBrowser = resolve(scraperDir, "../camofox-browser");
const bootstrap = join(scraperDir, "scripts/bootstrap-camofox-browser.sh");
const patch = join(
	scraperDir,
	"patches/camofox-browser/03-outbound-policy.patch",
);
const temporaryDirs: string[] = [];

async function fixture(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "agentic-scraper-bootstrap-"));
	temporaryDirs.push(directory);
	const browser = join(directory, "camofox-browser");
	await execFileAsync("git", ["clone", "--quiet", sourceBrowser, browser]);
	return browser;
}

async function bootstrapBrowser(browser: string): Promise<void> {
	await execFileAsync("bash", [bootstrap, browser]);
}

async function bootstrapFails(browser: string): Promise<void> {
	await expect(bootstrapBrowser(browser)).rejects.toMatchObject({
		code: 1,
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryDirs
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("Camoufox bootstrap state detection", () => {
	it("accepts an already-patched checkout with ignored node_modules", async () => {
		const browser = await fixture();
		await bootstrapBrowser(browser);
		await mkdir(join(browser, "node_modules"));
		await writeFile(
			join(browser, "node_modules", "local-package"),
			"generated",
		);
		await expect(bootstrapBrowser(browser)).resolves.toBeUndefined();
	});

	it("rejects an unrelated tracked change", async () => {
		const browser = await fixture();
		await bootstrapBrowser(browser);
		await writeFile(join(browser, "server.js"), "// unrelated change\n", {
			flag: "a",
		});
		await bootstrapFails(browser);
	});

	it("rejects an unrelated non-ignored untracked file", async () => {
		const browser = await fixture();
		await bootstrapBrowser(browser);
		await writeFile(join(browser, "unrelated-local-file"), "not ignored");
		await bootstrapFails(browser);
	});

	it("rejects a partially applied patch set", async () => {
		const browser = await fixture();
		await bootstrapBrowser(browser);
		await execFileAsync("git", ["-C", browser, "apply", "--reverse", patch]);
		await bootstrapFails(browser);
	});

	it("installs WebSocket policy guards on each browser context", async () => {
		const browser = await fixture();
		await bootstrapBrowser(browser);
		const policy = await import(
			pathToFileURL(join(browser, "lib/outbound-policy.js")).href
		);
		let websocketHandler:
			| ((websocket: {
					url(): string;
					connectToServer(): void;
					close(): void;
			  }) => Promise<void>)
			| undefined;
		const context = {
			route: vi.fn().mockResolvedValue(undefined),
			routeWebSocket: vi
				.fn()
				.mockImplementation(
					(_pattern: string, handler: typeof websocketHandler) => {
						websocketHandler = handler;
					},
				),
		};
		const log = vi.fn();

		await policy.installOutboundPolicy(context, "public", log);

		expect(context.routeWebSocket).toHaveBeenCalledWith(
			"**/*",
			expect.any(Function),
		);
		expect(
			await policy.outboundUrlAllowed("wss://93.184.216.34/socket", "public"),
		).toBe(true);
		expect(
			await policy.outboundUrlAllowed("ws://127.0.0.1/socket", "public"),
		).toBe(false);
		expect(
			await policy.outboundUrlAllowed("ws://127.0.0.1/socket", "loopback"),
		).toBe(true);
		expect(
			await policy.outboundUrlAllowed("ws://192.168.1.10/socket", "loopback"),
		).toBe(false);

		const publicSocket = {
			url: () => "wss://93.184.216.34/socket",
			connectToServer: vi.fn(),
			close: vi.fn(),
		};
		await websocketHandler?.(publicSocket);
		expect(publicSocket.connectToServer).toHaveBeenCalledOnce();
		expect(publicSocket.close).not.toHaveBeenCalled();

		const blockedSocket = {
			url: () => "ws://user:secret@127.0.0.1/socket",
			connectToServer: vi.fn(),
			close: vi.fn(),
		};
		await websocketHandler?.(blockedSocket);
		expect(blockedSocket.connectToServer).not.toHaveBeenCalled();
		expect(blockedSocket.close).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith(
			"warn",
			"blocked outbound browser websocket",
			{ host: "127.0.0.1", resourceType: "websocket" },
		);
	});
});
