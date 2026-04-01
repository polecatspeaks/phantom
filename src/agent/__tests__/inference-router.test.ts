import { describe, expect, test } from "bun:test";
import { decideInferenceRoute } from "../inference-router.ts";

const baseConfig = {
	inference: {
		mode: "auto" as const,
		local_model: "llama3.1:8b",
		local_complexity_threshold: 500,
		local_timeout_ms: 30000,
	},
};

describe("decideInferenceRoute", () => {
	test("routes forced cloud metadata to cloud", async () => {
		const decision = await decideInferenceRoute({
			text: "hello",
			config: baseConfig,
			metadata: { forceInferenceMode: "cloud" },
		});
		expect(decision.route).toBe("cloud");
		expect(decision.reason).toBe("forced_cloud");
	});

	test("pre-routes tool required request to cloud in local mode", async () => {
		const decision = await decideInferenceRoute({
			text: "please do this",
			config: { ...baseConfig, inference: { ...baseConfig.inference, mode: "local" } },
			toolRequired: true,
		});
		expect(decision.route).toBe("cloud");
		expect(decision.reason).toBe("tool_required");
	});

	test("routes cloud keyword to cloud", async () => {
		const decision = await decideInferenceRoute({
			text: "can you install dependencies",
			config: baseConfig,
		});
		expect(decision.route).toBe("cloud");
		expect(decision.reason).toBe("cloud_keyword");
	});

	test("routes conversational short text to local", async () => {
		const decision = await decideInferenceRoute({
			text: "hello",
			config: baseConfig,
		});
		expect(decision.route).toBe("local");
		expect(decision.reason).toBe("conversational");
	});

	test("forceInferenceMode=local overrides keyword heuristics", async () => {
		// Keyword heuristics must not block a caller-supplied forced_local override.
		const decision = await decideInferenceRoute({
			text: "build and deploy this",
			config: baseConfig,
			metadata: { forceInferenceMode: "local" },
		});
		expect(decision.route).toBe("local");
		expect(decision.reason).toBe("forced_local");
	});

	test("forceInferenceMode=local is still blocked by toolRequired", async () => {
		const decision = await decideInferenceRoute({
			text: "hello",
			config: baseConfig,
			metadata: { forceInferenceMode: "local" },
			toolRequired: true,
		});
		expect(decision.route).toBe("cloud");
		expect(decision.reason).toBe("tool_required");
	});

	test("routes 'set up' phrasing to cloud", async () => {
		const decision = await decideInferenceRoute({
			text: "set up log rotation for the phantom service",
			config: baseConfig,
		});
		expect(decision.route).toBe("cloud");
		expect(decision.reason).toBe("cloud_keyword");
	});

	test("routes 'walk me through' phrasing to cloud", async () => {
		const decision = await decideInferenceRoute({
			text: "walk me through how the inference router decides local vs cloud",
			config: baseConfig,
		});
		expect(decision.route).toBe("cloud");
		expect(decision.reason).toBe("cloud_keyword");
	});

	test("uses classifier near threshold when ambiguous", async () => {
		const classifier = {
			async classify(): Promise<{ route: "local" | "cloud"; confidence: number; reason: string }> {
				return { route: "cloud", confidence: 0.9, reason: "test_classifier" };
			},
		};
		const decision = await decideInferenceRoute({
			text: "x".repeat(1900),
			config: baseConfig,
			classifier,
		});
		expect(decision.route).toBe("cloud");
		expect(decision.usedClassifier).toBe(true);
		expect(decision.reason).toBe("classifier_cloud");
	});
});
