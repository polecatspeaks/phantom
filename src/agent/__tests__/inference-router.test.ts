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
