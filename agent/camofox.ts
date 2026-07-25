import {
	fetchWithTimeout,
	remainingMs,
	sleepWithinDeadline,
} from "../lib/abortable-fetch.js";
import {
	type OutboundUrlPolicyOptions,
	validateOutboundUrl,
} from "../outbound-url-policy.js";

export interface Tabs {
	create(
		url: string,
		sessionKey: string,
		timeoutMs?: number,
	): Promise<Record<string, unknown>>;
	snapshot(id: string): Promise<Record<string, unknown>>;
	click(id: string, ref: string): Promise<unknown>;
	type(
		id: string,
		ref: string,
		text: string,
		pressEnter?: boolean,
	): Promise<unknown>;
	scroll(id: string, direction: string): Promise<unknown>;
	navigate(id: string, url: string): Promise<unknown>;
	close(id: string): Promise<unknown>;
}

export interface CamofoxOptions {
	timeoutMs?: number;
	outboundPolicy?: OutboundUrlPolicyOptions;
}

export function createCamofox(
	camofoxUrl: string,
	userId: string,
	fetcher: typeof fetch = fetch,
	options: CamofoxOptions = {},
): Tabs {
	const timeoutMs = options.timeoutMs ?? 20_000;
	const request = async (
		method: string,
		path: string,
		body?: unknown,
		requestTimeoutMs = timeoutMs,
	): Promise<Record<string, unknown>> => {
		const res = await fetchWithTimeout(
			fetcher,
			camofoxUrl + path,
			{
				method,
				headers: body ? { "Content-Type": "application/json" } : {},
				body: body ? JSON.stringify(body) : undefined,
			},
			requestTimeoutMs,
			`Camoufox ${method} ${path}`,
		);
		const text = await res.text();
		if (!res.ok) {
			throw new Error(
				`camo ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`,
			);
		}
		return text ? (JSON.parse(text) as Record<string, unknown>) : {};
	};
	return {
		async create(url, sessionKey, requestTimeoutMs) {
			const target = await validateOutboundUrl(url, options.outboundPolicy);
			return request(
				"POST",
				"/tabs",
				{ userId, sessionKey, url: target.toString() },
				requestTimeoutMs,
			);
		},
		snapshot: (id) => request("GET", `/tabs/${id}/snapshot?userId=${userId}`),
		click: (id, ref) => request("POST", `/tabs/${id}/click`, { userId, ref }),
		type: (id, ref, text, pressEnter = false) =>
			request("POST", `/tabs/${id}/type`, { userId, ref, text, pressEnter }),
		scroll: (id, direction) =>
			request("POST", `/tabs/${id}/scroll`, { userId, direction }),
		async navigate(id, url) {
			const target = await validateOutboundUrl(url, options.outboundPolicy);
			return request("POST", `/tabs/${id}/navigate`, {
				userId,
				url: target.toString(),
			});
		},
		close: (id) => request("DELETE", `/tabs/${id}?userId=${userId}`),
	};
}

export async function wakeBrowser(
	camofoxUrl: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 20_000,
): Promise<void> {
	await fetchWithTimeout(
		fetcher,
		`${camofoxUrl}/health`,
		{},
		timeoutMs,
		"Camoufox wake",
	).then(() => undefined);
}

const retryable = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("503") || message.includes("session_expired");
};

export async function createTabWithRetry<T>(
	createTab: (
		url: string,
		sessionKey: string,
		timeoutMs?: number,
	) => Promise<T>,
	url: string,
	sessionKey: string,
	wake: (timeoutMs?: number) => Promise<void>,
	options: {
		timeoutMs?: number;
		sleep?: (milliseconds: number) => Promise<void>;
		now?: () => number;
	} = {},
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 20_000;
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ??
		((milliseconds) =>
			new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
	const deadline = now() + timeoutMs;
	let lastError: unknown = new Error("Camoufox readiness deadline exceeded");
	for (let attempt = 1; attempt <= 3; attempt++) {
		const remaining = remainingMs(deadline, now());
		if (remaining === 0) break;
		try {
			return await createTab(url, sessionKey, remaining);
		} catch (error) {
			lastError = error;
			if (!retryable(error) || attempt === 3) throw error;
			const wakeRemaining = remainingMs(deadline, now());
			if (wakeRemaining === 0) break;
			await wake(wakeRemaining);
			if (!(await sleepWithinDeadline(attempt * 250, deadline, sleep))) break;
		}
	}
	throw lastError;
}
