export class TimeoutError extends Error {
	constructor(operation: string, timeoutMs: number) {
		super(`${operation} timed out after ${timeoutMs}ms`);
		this.name = "TimeoutError";
	}
}

function combinedSignal(
	signal: AbortSignal | undefined,
	controller: AbortController,
) {
	return signal
		? AbortSignal.any([signal, controller.signal])
		: controller.signal;
}

export async function fetchWithTimeout(
	fetcher: typeof fetch,
	input: RequestInfo | URL,
	init: RequestInit = {},
	timeoutMs: number,
	operation: string,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetcher(input, {
			...init,
			signal: combinedSignal(init.signal ?? undefined, controller),
		});
	} catch (error) {
		if (controller.signal.aborted) throw new TimeoutError(operation, timeoutMs);
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

export function remainingMs(deadline: number, now = Date.now()): number {
	return Math.max(0, deadline - now);
}

export async function sleepWithinDeadline(
	milliseconds: number,
	deadline: number,
	sleep: (milliseconds: number) => Promise<void>,
): Promise<boolean> {
	const remaining = remainingMs(deadline);
	if (remaining < milliseconds) return false;
	await sleep(milliseconds);
	return true;
}
