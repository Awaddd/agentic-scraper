import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type OutboundMode = "public" | "loopback";

export interface OutboundUrlPolicyOptions {
	mode?: OutboundMode;
	lookup?: (hostname: string) => Promise<string[]>;
}

export class OutboundUrlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OutboundUrlError";
	}
}

const defaultLookup = async (hostname: string): Promise<string[]> =>
	(await dnsLookup(hostname, { all: true, verbatim: true })).map(
		(answer) => answer.address,
	);

function ipv4Parts(address: string): number[] | undefined {
	const parts = address.split(".");
	if (parts.length !== 4) return undefined;
	const numbers = parts.map(Number);
	return numbers.every(
		(part) => Number.isInteger(part) && part >= 0 && part <= 255,
	)
		? numbers
		: undefined;
}

function isLoopback(address: string): boolean {
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isLoopback(normalized.slice(7));
	const parts = ipv4Parts(address);
	return parts?.[0] === 127;
}

function isPublicIpv4(address: string): boolean {
	const parts = ipv4Parts(address);
	if (!parts) return false;
	const [a, b, c] = parts;
	if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
	if (a === 100 && b >= 64 && b <= 127) return false;
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && (b === 0 || b === 168)) return false;
	if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
	if (a === 203 && b === 0 && c === 113) return false;
	return true;
}

function isPublicIpv6(address: string): boolean {
	const normalized = address.toLowerCase();
	if (normalized.startsWith("::ffff:"))
		return isPublicIpv4(normalized.slice(7));
	if (normalized === "::" || normalized === "::1") return false;
	if (
		normalized.startsWith("fe8") ||
		normalized.startsWith("fe9") ||
		normalized.startsWith("fea") ||
		normalized.startsWith("feb")
	)
		return false;
	if (
		normalized.startsWith("fc") ||
		normalized.startsWith("fd") ||
		normalized.startsWith("ff")
	)
		return false;
	if (normalized.startsWith("2001:db8:")) return false;
	return normalized.startsWith("2") || normalized.startsWith("3");
}

function isPublicAddress(address: string): boolean {
	return isIP(address) === 4
		? isPublicIpv4(address)
		: isIP(address) === 6 && isPublicIpv6(address);
}

export async function validateOutboundUrl(
	raw: string,
	options: OutboundUrlPolicyOptions = {},
	origin?: string,
): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw, origin);
	} catch {
		throw new OutboundUrlError("URL is malformed");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new OutboundUrlError("URL must use HTTP(S)");
	}
	if (url.username || url.password) {
		throw new OutboundUrlError("URL credentials are not allowed");
	}

	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const addresses = isIP(hostname)
		? [hostname]
		: await (options.lookup ?? defaultLookup)(hostname);
	if (addresses.length === 0)
		throw new OutboundUrlError("URL hostname did not resolve");
	const mode = options.mode ?? "public";
	for (const address of addresses) {
		const permitted =
			isPublicAddress(address) || (mode === "loopback" && isLoopback(address));
		if (!permitted) {
			throw new OutboundUrlError(
				"URL resolves to a disallowed network address",
			);
		}
	}
	return url;
}

export async function normalizeOutboundUrl(
	raw: string,
	origin: string,
	options: OutboundUrlPolicyOptions = {},
): Promise<string | undefined> {
	try {
		return (await validateOutboundUrl(raw, options, origin)).toString();
	} catch {
		return undefined;
	}
}
