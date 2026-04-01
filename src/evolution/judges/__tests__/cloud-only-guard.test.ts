import { describe, expect, mock, test } from "bun:test";
import { z } from "zod/v4";

// Phase 11 guard: self-evolution judges must never route through the inference router.
// Judges use the raw Anthropic SDK for cross-model evaluation to avoid self-enhancement bias.
// If callJudge ever calls decideInferenceRoute or runLocalInference, these mocks will surface it.

const routerCallSpy = mock((): never => {
	throw new Error("judges must not use inference-router");
});
mock.module("../../../agent/inference-router.ts", () => ({
	decideInferenceRoute: routerCallSpy,
}));

const localInferenceCallSpy = mock((): never => {
	throw new Error("judges must not use local-inference");
});
mock.module("../../../agent/local-inference.ts", () => ({
	runLocalInference: localInferenceCallSpy,
}));

// Import after mocks are registered so any leaked import would be caught.
const { callJudge, setClient } = await import("../client.ts");

const judgeSchema = z.object({
	verdict: z.enum(["pass", "fail"]),
	confidence: z.number(),
	reasoning: z.string(),
});

describe("judges cloud-only isolation (Phase 11)", () => {
	test("callJudge uses raw Anthropic SDK, not inference router", async () => {
		const parseSpy = mock(async () => ({
			parsed_output: { verdict: "pass", confidence: 0.9, reasoning: "ok" },
			stop_reason: "end_turn",
			usage: { input_tokens: 100, output_tokens: 50 },
		}));

		setClient({ messages: { parse: parseSpy } } as Parameters<typeof setClient>[0]);

		await callJudge({
			model: "claude-sonnet-4-6",
			systemPrompt: "You are a judge.",
			userMessage: "Is this valid?",
			schema: judgeSchema,
		});

		// Anthropic client must be the only path used
		expect(parseSpy).toHaveBeenCalledTimes(1);

		// Inference router must never be invoked from the judge path
		expect(routerCallSpy).not.toHaveBeenCalled();
		expect(localInferenceCallSpy).not.toHaveBeenCalled();

		setClient(null);
	});

	test("callJudge result fields match the raw SDK output", async () => {
		const parseSpy = mock(async () => ({
			parsed_output: { verdict: "fail", confidence: 0.85, reasoning: "failed check" },
			stop_reason: "end_turn",
			usage: { input_tokens: 200, output_tokens: 80 },
		}));

		setClient({ messages: { parse: parseSpy } } as Parameters<typeof setClient>[0]);

		const result = await callJudge({
			model: "claude-sonnet-4-6",
			systemPrompt: "judge",
			userMessage: "check this",
			schema: judgeSchema,
		});

		expect(result.verdict).toBe("fail");
		expect(result.confidence).toBe(0.85);
		expect(result.reasoning).toBe("failed check");
		expect(result.model).toBe("claude-sonnet-4-6");
		expect(result.inputTokens).toBe(200);
		expect(result.outputTokens).toBe(80);
		expect(typeof result.costUsd).toBe("number");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);

		// Still no router calls in a second invocation
		expect(routerCallSpy).not.toHaveBeenCalled();
		expect(localInferenceCallSpy).not.toHaveBeenCalled();

		setClient(null);
	});

	test("callJudge throws when Anthropic returns no structured output", async () => {
		const parseSpy = mock(async () => ({
			parsed_output: null,
			stop_reason: "max_tokens",
			usage: { input_tokens: 50, output_tokens: 0 },
		}));

		setClient({ messages: { parse: parseSpy } } as Parameters<typeof setClient>[0]);

		await expect(
			callJudge({
				model: "claude-sonnet-4-6",
				systemPrompt: "judge",
				userMessage: "test",
				schema: judgeSchema,
			}),
		).rejects.toThrow("Judge returned no structured output");

		setClient(null);
	});
});
