import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { runMigrations } from "../../db/migrate.ts";
import type { PhantomConfig } from "../../config/types.ts";
import type { InferenceDecision } from "../inference-router.ts";

const mockDecideInferenceRoute = mock(async (): Promise<InferenceDecision> => ({
	route: "cloud" as const,
	reason: "mode_cloud" as const,
	tokenEstimate: 10,
	effectiveMode: "auto",
	usedClassifier: false,
}));

const mockRunLocalInference = mock(async () => ({ text: "local-response", model: "llama3.1:8b" }));

const mockQuery = mock((_args: unknown) =>
	(async function* () {
		yield {
			type: "system",
			subtype: "init",
			session_id: "sdk-session-1",
		};
		yield {
			type: "assistant",
			message: {
				content: [{ type: "text", text: "cloud-response" }],
			},
		};
		yield {
			type: "result",
			subtype: "success",
			result: "cloud-response",
			total_cost_usd: 0.01,
			usage: { input_tokens: 10, output_tokens: 5 },
			modelUsage: {
				"claude-sonnet-4-6": {
					inputTokens: 10,
					outputTokens: 5,
					costUSD: 0.01,
				},
			},
		};
	})(),
);

mock.module("../inference-router.ts", () => ({
	decideInferenceRoute: mockDecideInferenceRoute,
}));

mock.module("../local-inference.ts", () => ({
	runLocalInference: mockRunLocalInference,
}));

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
	query: mockQuery,
}));

const { AgentRuntime } = await import("../runtime.ts");

function makeConfig(mode: "auto" | "local" | "cloud" = "auto"): PhantomConfig {
	return {
		name: "test",
		port: 3100,
		role: "swe",
		model: "claude-sonnet-4-6",
		inference: {
			mode,
			local_model: "llama3.1:8b",
			local_complexity_threshold: 500,
			local_timeout_ms: 30000,
		},
		effort: "max",
		max_budget_usd: 0,
		daily_budget_usd: 0,
		budget_increment_alert_usd: 10,
		budget_alert_hour_eastern: 8,
		timeout_minutes: 5,
	};
}

describe("AgentRuntime inference routing", () => {
	let db: Database;

	beforeEach(() => {
		db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA foreign_keys = ON");
		runMigrations(db);
		mockDecideInferenceRoute.mockClear();
		mockRunLocalInference.mockClear();
		mockQuery.mockClear();
	});

	test("uses local response without invoking cloud query", async () => {
		mockDecideInferenceRoute.mockResolvedValueOnce({
			route: "local",
			reason: "conversational",
			tokenEstimate: 5,
			effectiveMode: "auto",
			usedClassifier: false,
		});
		mockRunLocalInference.mockResolvedValueOnce({ text: "hello from local", model: "llama3.1:8b" });

		const runtime = new AgentRuntime(makeConfig("auto"), db);
		const response = await runtime.handleMessage("cli", "conv-1", "hello");

		expect(response.text).toBe("hello from local");
		expect(mockRunLocalInference).toHaveBeenCalledTimes(1);
		expect(mockQuery).toHaveBeenCalledTimes(0);
	});

	test("falls back to cloud once when local inference fails", async () => {
		mockDecideInferenceRoute.mockResolvedValueOnce({
			route: "local",
			reason: "fallback_local",
			tokenEstimate: 50,
			effectiveMode: "auto",
			usedClassifier: false,
		});
		mockRunLocalInference.mockRejectedValueOnce(new Error("local failed"));

		const runtime = new AgentRuntime(makeConfig("auto"), db);
		const response = await runtime.handleMessage("cli", "conv-2", "do thing");

		expect(response.text).toBe("cloud-response");
		expect(mockRunLocalInference).toHaveBeenCalledTimes(1);
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});

	test("cloud route executes SDK query only once", async () => {
		mockDecideInferenceRoute.mockResolvedValueOnce({
			route: "cloud",
			reason: "mode_cloud",
			tokenEstimate: 200,
			effectiveMode: "cloud",
			usedClassifier: false,
		});

		const runtime = new AgentRuntime(makeConfig("cloud"), db);
		const response = await runtime.handleMessage("cli", "conv-3", "complex task");

		expect(response.text).toBe("cloud-response");
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});
});
