import { createHmac, timingSafeEqual } from "node:crypto";

function hmac(filename: string, expiry: number, secret: string): string {
	return createHmac("sha256", secret)
		.update(`${filename}:${expiry}`)
		.digest("hex");
}
export function signVideoUrl(
	filename: string,
	secret: string,
	now = Date.now(),
): string {
	const expiry = now + 86_400_000;
	return `?token=${hmac(filename, expiry, secret)}&expiry=${expiry}`;
}
export function verifySignedUrl(
	filename: string,
	token: string,
	expiry: string,
	secret: string,
	now = Date.now(),
): boolean {
	const expiryMs = Number(expiry);
	if (!token || !Number.isFinite(expiryMs) || expiryMs <= now) return false;
	const expected = hmac(filename, expiryMs, secret);
	if (token.length !== expected.length || !/^[0-9a-f]+$/i.test(token))
		return false;
	return timingSafeEqual(
		Buffer.from(expected, "hex"),
		Buffer.from(token, "hex"),
	);
}
