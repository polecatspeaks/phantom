import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";
import { hashTokenSync } from "../../mcp/config.ts";
import type { McpConfig } from "../../mcp/types.ts";
import { startServer } from "../server.ts";
import type { Database } from "bun:sqlite";
import { getDatabase } from "../../db/connection.ts";
import { runMigrations } from "../../db/migrate.ts";

describe("/api/dashboard endpoints", () => {
	const validToken = "test-dashboard-token";
	const readToken = "test-dashboard-read-token";

	const mcpConfigPath = "config/mcp.yaml";
	let originalMcpYaml: string | null = null;
	let server: ReturnType<typeof Bun.serve>;
	let baseUrl: string;
	let db: Database;

	beforeAll(() => {
		if (existsSync(mcpConfigPath)) {
			originalMcpYaml = readFileSync(mcpConfigPath, "utf-8");
		}

		const mcpConfig: McpConfig = {
			tokens: [
				{ name: "admin", hash: hashTokenSync(validToken), scopes: ["read", "operator", "admin"] },
				{ name: "reader", hash: hashTokenSync(readToken), scopes: ["read"] },
			],
			rate_limit: { requests_per_minute: 60, burst: 10 },
		};
		mkdirSync("config", { recursive: true });
		writeFileSync(mcpConfigPath, YAML.stringify(mcpConfig), "utf-8");

		db = getDatabase();
		runMigrations(db);

		// Seed session data
		db.run(`INSERT OR REPLACE INTO sessions
			(session_key, channel_id, conversation_id, status, total_cost_usd, input_tokens, output_tokens, turn_count, created_at, last_active_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-5 minutes'), datetime('now', '-2 minutes'))`,
			["trigger:discord:ch1", "trigger", "discord:ch1", "active", 0.0012, 800, 300, 3]);

		db.run(`INSERT OR REPLACE INTO sessions
			(session_key, channel_id, conversation_id, status, total_cost_usd, input_tokens, output_tokens, turn_count, created_at, last_active_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 hours'), datetime('now', '-1 hour'))`,
			["trigger:slack:bot123", "trigger", "slack:bot123", "expired", 0.0045, 2000, 800, 7]);

		// Seed cost events
		db.run(`INSERT INTO cost_events (session_key, cost_usd, input_tokens, output_tokens, model, created_at)
			VALUES (?, ?, ?, ?, ?, datetime('now', '-3 minutes'))`,
			["trigger:discord:ch1", 0.0012, 800, 300, "claude-sonnet-4-6"]);

		db.run(`INSERT INTO cost_events (session_key, cost_usd, input_tokens, output_tokens, model, created_at)
			VALUES (?, ?, ?, ?, ?, datetime('now', '-1 hour'))`,
			["trigger:slack:bot123", 0.0045, 2000, 800, "claude-sonnet-4-6"]);

		server = startServer({ name: "test", port: 0, role: "base" } as never, Date.now());
		baseUrl = `http://localhost:${server.port}`;
	});

	afterAll(() => {
		server?.stop(true);
		// Clean up seeded test data
		db.run("DELETE FROM cost_events WHERE session_key IN ('trigger:discord:ch1','trigger:slack:bot123')");
		db.run("DELETE FROM sessions WHERE session_key IN ('trigger:discord:ch1','trigger:slack:bot123')");
		if (originalMcpYaml !== null) {
			writeFileSync(mcpConfigPath, originalMcpYaml, "utf-8");
		}
	});

	// ── Auth ─────────────────────────────────────────────────────────
	test("returns 401 without auth on /channels", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/channels`);
		expect(res.status).toBe(401);
	});

	test("returns 401 without auth on /cost", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/cost`);
		expect(res.status).toBe(401);
	});

	test("returns 401 without auth on /sessions", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/sessions`);
		expect(res.status).toBe(401);
	});

	test("returns 401 on /sessions/:key without auth", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/sessions/some%3Akey`);
		expect(res.status).toBe(401);
	});

	test("read-scoped token can access dashboard routes", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/channels`, {
			headers: { Authorization: `Bearer ${readToken}` },
		});
		expect(res.status).toBe(200);
	});

	// ── /api/dashboard/channels ───────────────────────────────────────
	test("/channels returns array", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/channels`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		expect(res.status).toBe(200);
		const data = await res.json() as unknown[];
		expect(Array.isArray(data)).toBe(true);
	});

	test("/channels entries have expected shape", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/channels`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		const data = await res.json() as Array<Record<string, unknown>>;
		// Even with no channel_roles configured in test, shape must be correct
		if (data.length > 0) {
			const ch = data[0];
			expect(typeof ch.channel).toBe("string");
			expect(typeof ch.roleId).toBe("string");
			expect(typeof ch.roleName).toBe("string");
			expect(typeof ch.sessionCount).toBe("number");
		}
	});

	// ── /api/dashboard/cost ───────────────────────────────────────────
	test("/cost returns expected aggregation fields", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/cost?period=today`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		expect(res.status).toBe(200);
		const data = await res.json() as Record<string, unknown>;
		expect(typeof data.totalCostUsd).toBe("number");
		expect(typeof data.inputTokens).toBe("number");
		expect(typeof data.outputTokens).toBe("number");
		expect(typeof data.callCount).toBe("number");
		expect(Array.isArray(data.daily)).toBe(true);
	});

	test("/cost today sums seeded cost_events for today", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/cost?period=today`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		const data = await res.json() as Record<string, unknown>;
		// Both seeded events happened today — sum should be >= 0.0012
		expect(data.totalCostUsd as number).toBeGreaterThanOrEqual(0.0012);
	});

	test("/cost daily array has date and cost fields", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/cost?period=7d`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		const data = await res.json() as Record<string, unknown>;
		const daily = data.daily as Array<Record<string, unknown>>;
		if (daily.length > 0) {
			expect(typeof daily[0].date).toBe("string");
			expect(typeof daily[0].costUsd).toBe("number");
			expect(typeof daily[0].tokens).toBe("number");
		}
	});

	// ── /api/dashboard/sessions ───────────────────────────────────────
	test("/sessions returns paginated array", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/sessions`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		expect(res.status).toBe(200);
		const data = await res.json() as Record<string, unknown>;
		expect(Array.isArray(data.sessions)).toBe(true);
		expect(typeof data.total).toBe("number");
		expect(typeof data.limit).toBe("number");
		expect(typeof data.offset).toBe("number");
	});

	test("/sessions respects limit param", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/sessions?limit=1`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		const data = await res.json() as Record<string, unknown>;
		expect((data.sessions as unknown[]).length).toBeLessThanOrEqual(1);
		expect(data.limit).toBe(1);
	});

	test("/sessions entries have expected shape", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/sessions`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		const data = await res.json() as Record<string, unknown>;
		const sessions = data.sessions as Array<Record<string, unknown>>;
		if (sessions.length > 0) {
			const s = sessions[0];
			expect(typeof s.sessionKey).toBe("string");
			expect(typeof s.channelId).toBe("string");
			expect(typeof s.conversationId).toBe("string");
			expect(typeof s.totalCostUsd).toBe("number");
			expect(typeof s.turnCount).toBe("number");
			expect(typeof s.lastActiveAt).toBe("string");
		}
	});

	// ── /api/dashboard/sessions/:key ─────────────────────────────────
	test("/sessions/:key returns 404 for unknown key", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/sessions/nonexistent%3Akey`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		expect(res.status).toBe(404);
	});

	test("/sessions/:key returns session + events for known key", async () => {
		const key = encodeURIComponent("trigger:discord:ch1");
		const res = await fetch(`${baseUrl}/api/dashboard/sessions/${key}`, {
			headers: { Authorization: `Bearer ${validToken}` },
		});
		expect(res.status).toBe(200);
		const data = await res.json() as Record<string, unknown>;
		expect(data.session).toBeTruthy();
		expect(Array.isArray(data.events)).toBe(true);
		const session = data.session as Record<string, unknown>;
		expect(session.sessionKey).toBe("trigger:discord:ch1");
		// Events should include the seeded cost event
		expect((data.events as unknown[]).length).toBeGreaterThanOrEqual(1);
	});
});
