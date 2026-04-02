import type { Database } from "bun:sqlite";

export type ChannelEntry = {
	channel: string;
	roleId: string;
	roleName: string;
	sessionCount: number;
	lastActiveAt: string | null;
	online: boolean;
	activeNow: boolean;
};

export type CostPeriod = "today" | "7d" | "30d" | "all";

export type DailyBucket = {
	date: string;
	costUsd: number;
	tokens: number;
	calls: number;
};

export type CostSummary = {
	totalCostUsd: number;
	inputTokens: number;
	outputTokens: number;
	callCount: number;
	daily: DailyBucket[];
};

export type SessionRow = {
	sessionKey: string;
	channelId: string;
	conversationId: string;
	status: string;
	totalCostUsd: number;
	inputTokens: number;
	outputTokens: number;
	turnCount: number;
	createdAt: string;
	lastActiveAt: string;
};

export type SessionsPage = {
	sessions: SessionRow[];
	total: number;
	limit: number;
	offset: number;
};

export type CostEventRow = {
	id: number;
	sessionKey: string;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	model: string;
	createdAt: string;
};

export type SessionDetail = {
	session: SessionRow;
	events: CostEventRow[];
};

// Role name display map — matched from role id
const ROLE_NAMES: Record<string, string> = {
	swe: "Software Engineer",
	social: "Social",
	base: "Base",
};

function roleDisplayName(roleId: string): string {
	return ROLE_NAMES[roleId] ?? roleId;
}

function periodClause(period: CostPeriod): string {
	switch (period) {
		case "today":
			return "AND date(created_at) = date('now')";
		case "7d":
			return "AND created_at >= datetime('now', '-7 days')";
		case "30d":
			return "AND created_at >= datetime('now', '-30 days')";
		case "all":
			return "";
	}
}

export function getChannels(
	db: Database,
	channelRoles: Record<string, string> | undefined,
	liveChannels: Record<string, boolean>,
): ChannelEntry[] {
	if (!channelRoles || Object.keys(channelRoles).length === 0) return [];

	return Object.entries(channelRoles).map(([channel, roleId]) => {
		// Sessions whose conversation_id starts with `<channel>:` were routed through this channel
		const row = db
			.query(
				`SELECT COUNT(*) as cnt, MAX(last_active_at) as last_active
				 FROM sessions
				 WHERE conversation_id LIKE ? AND last_active_at >= datetime('now', '-24 hours')`,
			)
			.get(`${channel}:%`) as { cnt: number; last_active: string | null };

		// Active = session touched in the last 5 minutes (catches trigger-based channels like Discord)
		const activeRow = db
			.query(
				`SELECT COUNT(*) as cnt FROM sessions
				 WHERE conversation_id LIKE ? AND last_active_at >= datetime('now', '-5 minutes')`,
			)
			.get(`${channel}:%`) as { cnt: number };

		const activeNow = (activeRow?.cnt ?? 0) > 0;

		return {
			channel,
			roleId,
			roleName: roleDisplayName(roleId),
			sessionCount: row?.cnt ?? 0,
			lastActiveAt: row?.last_active ?? null,
			// online: true if socket connected (Slack) OR active in last 5 min (Discord/trigger)
			online: (liveChannels[channel] ?? false) || activeNow,
			activeNow,
		};
	});
}

export function getCostSummary(db: Database, period: CostPeriod): CostSummary {
	const where = periodClause(period);

	const agg = db
		.query(
			`SELECT
				COALESCE(SUM(cost_usd), 0)       AS total_cost,
				COALESCE(SUM(input_tokens), 0)   AS input_tokens,
				COALESCE(SUM(output_tokens), 0)  AS output_tokens,
				COUNT(*)                          AS call_count
			 FROM cost_events WHERE 1=1 ${where}`,
		)
		.get() as { total_cost: number; input_tokens: number; output_tokens: number; call_count: number };

	// Daily buckets — always return last 30 days for the chart regardless of period
	const dailyRows = db
		.query(
			`SELECT
				date(created_at) AS date,
				SUM(cost_usd)    AS cost_usd,
				SUM(input_tokens + output_tokens) AS tokens,
				COUNT(*)         AS calls
			 FROM cost_events
			 WHERE created_at >= datetime('now', '-30 days')
			 GROUP BY date(created_at)
			 ORDER BY date(created_at) ASC`,
		)
		.all() as Array<{ date: string; cost_usd: number; tokens: number; calls: number }>;

	return {
		totalCostUsd: agg?.total_cost ?? 0,
		inputTokens: agg?.input_tokens ?? 0,
		outputTokens: agg?.output_tokens ?? 0,
		callCount: agg?.call_count ?? 0,
		daily: dailyRows.map((r) => ({
			date: r.date,
			costUsd: r.cost_usd,
			tokens: r.tokens,
			calls: r.calls,
		})),
	};
}

export function getSessions(
	db: Database,
	channel?: string,
	limit = 20,
	offset = 0,
): SessionsPage {
	const safeLimit = Math.min(Math.max(1, limit), 100);
	const safeOffset = Math.max(0, offset);

	let where = "WHERE 1=1";
	const params: (string | number)[] = [];

	if (channel) {
		where += " AND conversation_id LIKE ?";
		params.push(`${channel}:%`);
	}

	const total = (
		db.query(`SELECT COUNT(*) as cnt FROM sessions ${where}`).get(...params) as { cnt: number }
	).cnt;

	const rows = db
		.query(
			`SELECT session_key, channel_id, conversation_id, status,
					total_cost_usd, input_tokens, output_tokens, turn_count,
					created_at, last_active_at
			 FROM sessions
			 ${where}
			 ORDER BY last_active_at DESC
			 LIMIT ? OFFSET ?`,
		)
		.all(...params, safeLimit, safeOffset) as Array<{
		session_key: string;
		channel_id: string;
		conversation_id: string;
		status: string;
		total_cost_usd: number;
		input_tokens: number;
		output_tokens: number;
		turn_count: number;
		created_at: string;
		last_active_at: string;
	}>;

	return {
		sessions: rows.map((r) => ({
			sessionKey: r.session_key,
			channelId: r.channel_id,
			conversationId: r.conversation_id,
			status: r.status,
			totalCostUsd: r.total_cost_usd,
			inputTokens: r.input_tokens,
			outputTokens: r.output_tokens,
			turnCount: r.turn_count,
			createdAt: r.created_at,
			lastActiveAt: r.last_active_at,
		})),
		total,
		limit: safeLimit,
		offset: safeOffset,
	};
}

export function getSessionDetail(db: Database, sessionKey: string): SessionDetail | null {
	const sessionRow = db
		.query(
			`SELECT session_key, channel_id, conversation_id, status,
					total_cost_usd, input_tokens, output_tokens, turn_count,
					created_at, last_active_at
			 FROM sessions WHERE session_key = ?`,
		)
		.get(sessionKey) as {
		session_key: string;
		channel_id: string;
		conversation_id: string;
		status: string;
		total_cost_usd: number;
		input_tokens: number;
		output_tokens: number;
		turn_count: number;
		created_at: string;
		last_active_at: string;
	} | null;

	if (!sessionRow) return null;

	const events = db
		.query(
			`SELECT id, session_key, cost_usd, input_tokens, output_tokens, model, created_at
			 FROM cost_events WHERE session_key = ? ORDER BY created_at ASC`,
		)
		.all(sessionKey) as Array<{
		id: number;
		session_key: string;
		cost_usd: number;
		input_tokens: number;
		output_tokens: number;
		model: string;
		created_at: string;
	}>;

	return {
		session: {
			sessionKey: sessionRow.session_key,
			channelId: sessionRow.channel_id,
			conversationId: sessionRow.conversation_id,
			status: sessionRow.status,
			totalCostUsd: sessionRow.total_cost_usd,
			inputTokens: sessionRow.input_tokens,
			outputTokens: sessionRow.output_tokens,
			turnCount: sessionRow.turn_count,
			createdAt: sessionRow.created_at,
			lastActiveAt: sessionRow.last_active_at,
		},
		events: events.map((e) => ({
			id: e.id,
			sessionKey: e.session_key,
			costUsd: e.cost_usd,
			inputTokens: e.input_tokens,
			outputTokens: e.output_tokens,
			model: e.model,
			createdAt: e.created_at,
		})),
	};
}

export function handleDashboardRequest(
	req: Request,
	url: URL,
	db: Database,
	channelRoles: Record<string, string> | undefined,
	liveChannels: Record<string, boolean>,
): Response {
	const json = (data: unknown, status = 200): Response =>
		new Response(JSON.stringify(data), {
			status,
			headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
		});

	if (url.pathname === "/api/dashboard/channels") {
		return json(getChannels(db, channelRoles, liveChannels));
	}

	if (url.pathname === "/api/dashboard/cost") {
		const rawPeriod = url.searchParams.get("period") ?? "today";
		const period: CostPeriod = ["today", "7d", "30d", "all"].includes(rawPeriod)
			? (rawPeriod as CostPeriod)
			: "today";
		return json(getCostSummary(db, period));
	}

	if (url.pathname === "/api/dashboard/sessions") {
		const channel = url.searchParams.get("channel") ?? undefined;
		const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
		const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
		return json(getSessions(db, channel, limit, offset));
	}

	const sessionDetailMatch = url.pathname.match(/^\/api\/dashboard\/sessions\/(.+)$/);
	if (sessionDetailMatch) {
		const sessionKey = decodeURIComponent(sessionDetailMatch[1]);
		const detail = getSessionDetail(db, sessionKey);
		if (!detail) return json({ error: "Session not found" }, 404);
		return json(detail);
	}

	return json({ error: "Not found" }, 404);
}
