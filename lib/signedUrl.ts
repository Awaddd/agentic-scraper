import { createHmac, timingSafeEqual } from "crypto";

function computeHmac(filename: string, expiry: number): string {
  const secret = process.env.VIDEO_SECRET ?? "";
  return createHmac("sha256", secret)
    .update(`${filename}:${expiry}`)
    .digest("hex");
}

export function signVideoUrl(filename: string): string {
  const expiry = Date.now() + 86_400_000;
  const token = computeHmac(filename, expiry);
  return `?token=${token}&expiry=${expiry}`;
}

export function verifySignedUrl(filename: string, token: string, expiry: string): boolean {
  if (!token) return false;

  const expiryMs = Number(expiry);
  if (expiryMs <= Date.now()) return false;

  const expected = computeHmac(filename, expiryMs);
  const expectedBuf = Buffer.from(expected, "hex");

  // Reject if token isn't a valid hex string of exactly the right length
  if (token.length !== expected.length || !/^[0-9a-f]+$/i.test(token)) return false;

  const providedBuf = Buffer.from(token, "hex");

  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
