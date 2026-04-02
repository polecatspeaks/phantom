#!/usr/bin/env bun
/**
 * Benchmark Ollama models for Phantom's local inference tier.
 *
 * Tests models against prompts that represent Phantom's actual local-tier traffic:
 * - Simple status/fact lookups (no tools needed)
 * - Short summarization tasks
 * - Scheduler observation formatting
 *
 * Usage:
 *   bun scripts/benchmark-local-models.ts
 *   bun scripts/benchmark-local-models.ts --host http://10.0.0.154:11434
 *   bun scripts/benchmark-local-models.ts --models llama3.1:8b,mistral:7b
 */

const args = process.argv.slice(2);
const hostArg = args.find((a) => a.startsWith("--host="))?.split("=")[1] ?? "http://localhost:11434";
const modelsArg = args.find((a) => a.startsWith("--models="))?.split("=")[1];
const defaultModels = ["llama3.1:8b", "mistral:7b"];
const models = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : defaultModels;

// Representative prompts for the local inference tier.
// These are tasks routed to local models when toolRequired=false.
const PROMPTS: Array<{ name: string; system: string; prompt: string }> = [
	{
		name: "status-check",
		system: "You are Phantom, a helpful AI assistant. Answer concisely.",
		prompt: "What is the capital of France? Just state the city name.",
	},
	{
		name: "summarize-short",
		system: "You are Phantom. Summarize in 2 sentences.",
		prompt:
			"The Rust programming language provides memory safety without garbage collection by using a system of ownership with rules that the compiler checks at compile time. No runtime or garbage collector is needed. Compile-time checks guarantee memory safety.",
	},
	{
		name: "scheduler-observation",
		system:
			"You are Phantom. Generate a one-line status report in JSON: {status, summary, next_action}. Output only JSON.",
		prompt: "Slack bot watchdog ran. All 3 monitored channels are responsive. No errors detected.",
	},
	{
		name: "tool-free-reasoning",
		system:
			"You are Phantom. Answer in plain text under 50 words. Do not use any external tools.",
		prompt:
			"Is 2048 a power of 2? Explain briefly.",
	},
	{
		name: "json-output",
		system: "You are Phantom. Output ONLY a JSON object with keys: name, color, weight_kg.",
		prompt: "A tabby cat named Mochi. Orange. Weighs 4.2 kilograms.",
	},
];

type OllamaResponse = {
	response?: string;
	message?: { content?: string };
	eval_count?: number;
	eval_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	total_duration?: number;
};

type BenchResult = {
	model: string;
	prompt: string;
	ok: boolean;
	durationMs: number;
	tokensGenerated: number;
	tokensPerSec: number;
	firstTokenMs: number;
	outputPreview: string;
	error?: string;
};

async function runBench(model: string, p: { name: string; system: string; prompt: string }): Promise<BenchResult> {
	const start = Date.now();
	try {
		const body = {
			model,
			messages: [
				{ role: "system", content: p.system },
				{ role: "user", content: p.prompt },
			],
			stream: false,
		};

		const res = await fetch(`${hostArg}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30_000),
		});

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}

		const data = (await res.json()) as OllamaResponse;
		const durationMs = Date.now() - start;
		const text = data.message?.content ?? data.response ?? "";
		const tokensGenerated = data.eval_count ?? 0;
		const evalDurationNs = data.eval_duration ?? 0;
		const tokensPerSec = evalDurationNs > 0 ? tokensGenerated / (evalDurationNs / 1e9) : 0;
		const firstTokenMs = data.load_duration != null ? Math.round(data.load_duration / 1e6) : durationMs;

		return {
			model,
			prompt: p.name,
			ok: true,
			durationMs,
			tokensGenerated,
			tokensPerSec: Math.round(tokensPerSec * 10) / 10,
			firstTokenMs,
			outputPreview: text.slice(0, 80).replace(/\n/g, " "),
		};
	} catch (err: unknown) {
		return {
			model,
			prompt: p.name,
			ok: false,
			durationMs: Date.now() - start,
			tokensGenerated: 0,
			tokensPerSec: 0,
			firstTokenMs: 0,
			outputPreview: "",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

function pad(s: string | number, n: number): string {
	return String(s).padEnd(n);
}

function rpad(s: string | number, n: number): string {
	return String(s).padStart(n);
}

// Verify the Ollama host is reachable before running benchmarks
async function checkHost(): Promise<string[]> {
	const res = await fetch(`${hostArg}/api/tags`, { signal: AbortSignal.timeout(5_000) });
	if (!res.ok) throw new Error(`Ollama host responded with HTTP ${res.status}`);
	const data = (await res.json()) as { models?: Array<{ name: string }> };
	return (data.models ?? []).map((m) => m.name);
}

async function main() {
	console.log(`\nPhantom Local Model Benchmark`);
	console.log(`Host : ${hostArg}`);
	console.log(`Models: ${models.join(", ")}`);
	console.log(`Prompts: ${PROMPTS.length}\n`);

	let available: string[] = [];
	try {
		available = await checkHost();
		console.log(`Available models on host: ${available.join(", ") || "(none)"}\n`);
	} catch (err: unknown) {
		console.error(`ERROR: Cannot reach Ollama at ${hostArg}: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}

	const results: BenchResult[] = [];
	for (const model of models) {
		const isAvailable = available.some((a) => a === model || a.startsWith(`${model}:`));
		if (!isAvailable) {
			console.warn(`WARNING: Model ${model} not found on host - skipping`);
			continue;
		}
		console.log(`--- ${model} ---`);
		// Warm-up run
		await runBench(model, PROMPTS[0]);

		for (const p of PROMPTS) {
			process.stdout.write(`  ${pad(p.name, 28)}`);
			const r = await runBench(model, p);
			results.push(r);
			if (r.ok) {
				console.log(`${rpad(r.durationMs, 6)}ms  ${rpad(r.tokensPerSec, 5)} tok/s  "${r.outputPreview}"`);
			} else {
				console.log(`FAIL: ${r.error}`);
			}
		}
		console.log("");
	}

	// Summary table
	console.log("=== Summary ===");
	console.log(
		`${pad("Model", 20)} ${pad("Prompt", 28)} ${rpad("ms", 6)} ${rpad("tok/s", 6)} ${pad("Status", 6)}`,
	);
	console.log("-".repeat(78));
	for (const r of results) {
		console.log(
			`${pad(r.model, 20)} ${pad(r.prompt, 28)} ${rpad(r.durationMs, 6)} ${rpad(r.tokensPerSec, 6)} ${r.ok ? "OK" : "FAIL"}`,
		);
	}

	// Per-model averages
	console.log("\n=== Per-model averages (passing only) ===");
	for (const model of models) {
		const passed = results.filter((r) => r.model === model && r.ok);
		if (passed.length === 0) {
			console.log(`${pad(model, 20)} No passing results`);
			continue;
		}
		const avgMs = Math.round(passed.reduce((s, r) => s + r.durationMs, 0) / passed.length);
		const avgTps = Math.round((passed.reduce((s, r) => s + r.tokensPerSec, 0) / passed.length) * 10) / 10;
		const passRate = `${passed.length}/${PROMPTS.length}`;
		console.log(`${pad(model, 20)} avg ${rpad(avgMs, 5)}ms  ${rpad(avgTps, 5)} tok/s  pass ${passRate}`);
	}
	console.log("");
}

main().catch((err) => {
	console.error("Benchmark failed:", err);
	process.exit(1);
});
