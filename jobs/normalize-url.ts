import {
	normalizeOutboundUrl,
	type OutboundUrlPolicyOptions,
} from "../outbound-url-policy.js";

export function normalizeUrl(
	raw: string,
	origin: string,
	policy?: OutboundUrlPolicyOptions,
): Promise<string | undefined> {
	return normalizeOutboundUrl(raw, origin, policy);
}
