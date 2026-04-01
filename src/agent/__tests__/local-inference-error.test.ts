import { describe, expect, test } from "bun:test";
import { normalizeLocalInferenceError } from "../local-inference-error.ts";

describe("normalizeLocalInferenceError", () => {
	test("maps 503 to service_unavailable", () => {
		const err = normalizeLocalInferenceError({
			model: "llama3.1:8b",
			error: new Error("upstream unavailable"),
			statusCode: 503,
		});
		expect(err.category).toBe("service_unavailable");
		expect(err.retryable).toBe(true);
	});

	test("maps 404 to model_not_found", () => {
		const err = normalizeLocalInferenceError({
			model: "llama3.1:8b",
			error: new Error("not found"),
			statusCode: 404,
		});
		expect(err.category).toBe("model_not_found");
		expect(err.retryable).toBe(false);
	});

	test("maps timeout message to timeout", () => {
		const err = normalizeLocalInferenceError({
			model: "llama3.1:8b",
			error: new Error("request timed out"),
		});
		expect(err.category).toBe("timeout");
		expect(err.retryable).toBe(true);
	});

	test("uses malformed_response hint", () => {
		const err = normalizeLocalInferenceError({
			model: "llama3.1:8b",
			error: new Error("bad payload"),
			categoryHint: "malformed_response",
		});
		expect(err.category).toBe("malformed_response");
		expect(err.retryable).toBe(false);
	});
});
