import { createHmac } from "node:crypto";
import { fetchWithTimeout } from "../lib/abortable-fetch.js";
import {
	type OutboundUrlPolicyOptions,
	validateOutboundUrl,
} from "../outbound-url-policy.js";

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
	timestamp = new Date().toISOString(),
): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (secret)
		Object.assign(headers, {
			"X-Scraper-Signature": createHmac("sha256", secret)
				.update(`${timestamp}.${body}`)
				.digest("hex"),
			"X-Scraper-Timestamp": timestamp,
		});
	return headers;
}

export async function deliverWebhook(
	url: string,
	payload: unknown,
	secret: string | undefined,
	fetcher: typeof fetch = fetch,
	timeoutMs = 10_000,
	policy?: OutboundUrlPolicyOptions,
): Promise<void> {
	const body = JSON.stringify(payload);
	const timestamp = new Date().toISOString();
	const deadline = Date.now() + timeoutMs;
	let target = await validateOutboundUrl(url, policy);
	let response: Response | undefined;
	for (let redirects = 0; redirects <= 5; redirects++) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("webhook delivery timed out");
		response = await fetchWithTimeout(
			fetcher,
			target,
			{
				method: "POST",
				headers: buildWebhookHeaders(body, secret, timestamp),
				body,
				redirect: "manual",
			},
			remaining,
			"webhook delivery",
		);
		if (response.status < 300 || response.status >= 400) break;
		const location = response.headers.get("location");
		if (!location) throw new Error("webhook redirect had no location");
		target = await validateOutboundUrl(location, policy, target.toString());
	}
	if (!response) throw new Error("webhook delivery failed");
	if (!response.ok)
		throw new Error(`webhook returned non-2xx: ${response.status}`);
}
