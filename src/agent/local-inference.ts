import { normalizeLocalInferenceError } from "./local-inference-error.ts";

export type LocalInferenceRequest = {
	baseUrl?: string;
	model: string;
	prompt: string;
	timeoutMs: number;
};

export type LocalInferenceResponse = {
	text: string;
	model: string;
};

export async function runLocalInference(request: LocalInferenceRequest): Promise<LocalInferenceResponse> {
	const baseUrl = request.baseUrl ?? "http://localhost:11434";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

	try {
		const response = await fetch(`${baseUrl}/api/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: request.model,
				prompt: request.prompt,
				stream: false,
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw normalizeLocalInferenceError({
				model: request.model,
				error: new Error(`Ollama returned HTTP ${response.status}`),
				statusCode: response.status,
			});
		}

		const data = (await response.json()) as { response?: unknown };
		if (typeof data.response !== "string") {
			throw normalizeLocalInferenceError({
				model: request.model,
				error: new Error("Malformed Ollama response payload"),
				categoryHint: "malformed_response",
			});
		}

		return { text: data.response, model: request.model };
	} catch (error: unknown) {
		if (
			typeof error === "object" &&
			error !== null &&
			"kind" in error &&
			(error as { kind?: string }).kind === "local_inference_error"
		) {
			throw error;
		}

		throw normalizeLocalInferenceError({
			model: request.model,
			error,
		});
	} finally {
		clearTimeout(timeout);
	}
}
