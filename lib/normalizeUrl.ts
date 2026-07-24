export function normalizeUrl(raw: string, origin: string): string {
  if (raw.startsWith("http")) return raw;
  return origin + raw;
}
