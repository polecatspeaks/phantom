export type LocalInferenceErrorCategory =
	| "timeout"
	| "service_unavailable"
	| "model_not_found"
	| "malformed_response"
	| "network"
	| "unknown";

export type LocalInferenceError = {
	kind: "local_inference_error";
	category: LocalInferenceErrorCategory;
	retryable: boolean;
	provider: "ollama";
	model: string;
	statusCode: number | null;
	message: string;
	cause: unknown;
};

export function normalizeLocalInferenceError(input: {
	model: string;
	error: unknown;
	statusCode?: number | null;
	categoryHint?: LocalInferenceErrorCategory;
}): LocalInferenceError {
	const statusCode = input.statusCode ?? null;
	const message = input.error instanceof Error ? input.error.message : String(input.error);
	const lower = message.toLowerCase();

	let category: LocalInferenceErrorCategory = input.categoryHint ?? "unknown";
	if (!input.categoryHint) {
		if (statusCode === 503) {
			category = "service_unavailable";
		} else if (statusCode === 404 || lower.includes("model") || lower.includes("not found")) {
			category = "model_not_found";
		} else if (lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out")) {
			category = "timeout";
		} else if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("econnrefused")) {
			category = "network";
		}
	}

	const retryable =
		category === "timeout" ||
		category === "service_unavailable" ||
		(category === "network" && statusCode == null);

	return {
		kind: "local_inference_error",
		category,
		retryable,
		provider: "ollama",
		model: input.model,
		statusCode,
		message,
		cause: input.error,
	};
}
