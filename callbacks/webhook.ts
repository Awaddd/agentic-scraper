import { createHmac } from "node:crypto";

export function buildWebhookPayload(fields: {
	jobId: string;
	type: string;
	ok: boolean;
	result: unknown;
	tokens: { prompt: number; completion: number; total: number };
	steps: number;
	durationMs: number;
	videoUrl?: string;
	error?: string;
	metadata?: Record<string, unknown>;
}): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		jobId: fields.jobId,
		type: fields.type,
		ok: fields.ok,
		result: fields.result,
		tokens: fields.tokens,
		steps: fields.steps,
		durationMs: fields.durationMs,
	};
	if (fields.videoUrl !== undefined) payload.videoUrl = fields.videoUrl;
	if (fields.error !== undefined) payload.error = fields.error;
	if (fields.metadata !== undefined) payload.metadata = fields.metadata;
	return payload;
}

export function buildWebhookHeaders(
	body: string,
	secret?: string,
): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (secret)
		Object.assign(headers, {
			"X-Scraper-Signature": createHmac("sha256", secret)
				.update(body)
				.digest("hex"),
			"X-Scraper-Timestamp": new Date().toISOString(),
		});
	return headers;
}

export async function deliverWebhook(
	url: string,
	payload: unknown,
	secret: string | undefined,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const body = JSON.stringify(payload);
	const response = await fetcher(url, {
		method: "POST",
		headers: buildWebhookHeaders(body, secret),
		body,
	});
	if (!response.ok)
		throw new Error(`webhook returned non-2xx: ${response.status}`);
}
