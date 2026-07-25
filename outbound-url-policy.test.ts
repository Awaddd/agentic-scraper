import { describe, expect, it } from "vitest";
import {
	normalizeOutboundUrl,
	validateOutboundUrl,
} from "./outbound-url-policy.js";

const publicDns = async () => ["93.184.216.34"];

describe("outbound URL policy", () => {
	it("allows public hosts and canonicalizes relative listing URLs", async () => {
		await expect(
			validateOutboundUrl("https://example.test/a", { lookup: publicDns }),
		).resolves.toMatchObject({ hostname: "example.test" });
		await expect(
			normalizeOutboundUrl("../job", "https://example.test/jobs/open", {
				lookup: publicDns,
			}),
		).resolves.toBe("https://example.test/job");
	});

	it("rejects credentials, non-HTTP URLs, private IPs, and mixed DNS answers", async () => {
		for (const url of [
			"ftp://example.test/file",
			"https://user:pass@example.test/",
			"http://127.0.0.1/",
			"http://[::1]/",
			"http://10.0.0.1/",
			"http://169.254.1.1/",
			"http://192.168.1.1/",
			"http://[fe80::1]/",
			"http://224.0.0.1/",
		]) {
			await expect(
				validateOutboundUrl(url, { lookup: publicDns }),
			).rejects.toThrow();
		}
		await expect(
			validateOutboundUrl("https://mixed.test", {
				lookup: async () => ["93.184.216.34", "127.0.0.1"],
			}),
		).rejects.toThrow("disallowed");
	});

	it("permits loopback only under the explicit local mode and still rejects LAN", async () => {
		await expect(
			validateOutboundUrl("http://localhost:4000", {
				mode: "loopback",
				lookup: async () => ["127.0.0.1", "::1"],
			}),
		).resolves.toMatchObject({ hostname: "localhost" });
		await expect(
			validateOutboundUrl("http://localhost:4000", {
				lookup: async () => ["127.0.0.1"],
			}),
		).rejects.toThrow();
		await expect(
			validateOutboundUrl("http://192.168.0.1", { mode: "loopback" }),
		).rejects.toThrow();
	});

	it("omits invalid listing URLs", async () => {
		await expect(
			normalizeOutboundUrl("http://127.0.0.1/admin", "https://example.test", {
				lookup: publicDns,
			}),
		).resolves.toBeUndefined();
	});
});
