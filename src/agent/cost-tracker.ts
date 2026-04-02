import type { Database } from "bun:sqlite";
import type { AgentCost } from "./events.ts";

type AlertDeps = {
	sendDm: (userId: string, text: string) => Promise<void>;
	ownerUserId: string;
	incrementAlertUsd: number;
	dailyBudgetUsd: number;
};

export class CostTracker {
	private db: Database;
	private alertDeps: AlertDeps | null = null;
	// Total USD at which the last increment alert fired; avoid re-firing for same threshold
	private lastIncrementAlertThreshold = 0;

	constructor(db: Database) {
		this.db = db;
	}

	setAlertDeps(deps: AlertDeps): void {
		this.alertDeps = deps;
		this.lastIncrementAlertThreshold = 0;
	}

	record(sessionKey: string, cost: AgentCost, model: string): void {
		this.db.run(
			`INSERT INTO cost_events (session_key, cost_usd, input_tokens, output_tokens, model)
			 VALUES (?, ?, ?, ?, ?)`,
			[sessionKey, cost.totalUsd, cost.inputTokens, cost.outputTokens, model],
		);

		this.db.run(
			`UPDATE sessions SET
				total_cost_usd = total_cost_usd + ?,
				input_tokens = input_tokens + ?,
				output_tokens = output_tokens + ?,
				turn_count = turn_count + 1,
				last_active_at = datetime('now')
			 WHERE session_key = ?`,
			[cost.totalUsd, cost.inputTokens, cost.outputTokens, sessionKey],
		);

		if (this.alertDeps && this.alertDeps.incrementAlertUsd > 0) {
			const dailyTotal = this.getDailyTotal();
			const threshold = Math.floor(dailyTotal / this.alertDeps.incrementAlertUsd) * this.alertDeps.incrementAlertUsd;
			if (threshold > 0 && threshold > this.lastIncrementAlertThreshold) {
				this.lastIncrementAlertThreshold = threshold;
				const deps = this.alertDeps;
				deps
					.sendDm(
						deps.ownerUserId,
						`:money_with_wings: *Cost alert:* Today's API spend has crossed *$${threshold.toFixed(2)}* (current: $${dailyTotal.toFixed(4)})`,
					)
					.catch((err: unknown) => {
						console.warn("[cost-tracker] Failed to send increment alert:", err);
					});
			}
		}
	}

	getDailyTotal(): number {
		const row = this.db
			.query(
				`SELECT COALESCE(SUM(cost_usd), 0) AS total
				 FROM cost_events
				 WHERE date(created_at) = date('now')`,
			)
			.get() as { total: number } | null;
		return row?.total ?? 0;
	}

	fireDailySummary(): void {
		if (!this.alertDeps) return;
		const total = this.getDailyTotal();
		const deps = this.alertDeps;
		const budgetNote =
			deps.dailyBudgetUsd > 0
				? ` (budget: $${deps.dailyBudgetUsd.toFixed(2)}, ${((total / deps.dailyBudgetUsd) * 100).toFixed(1)}% used)`
				: "";
		deps
			.sendDm(
				deps.ownerUserId,
				`:bar_chart: *Daily cost summary:* $${total.toFixed(4)} spent today${budgetNote}`,
			)
			.catch((err: unknown) => {
				console.warn("[cost-tracker] Failed to send daily summary:", err);
			});
	}

	getSessionCost(sessionKey: string): number {
		const row = this.db.query("SELECT total_cost_usd FROM sessions WHERE session_key = ?").get(sessionKey) as {
			total_cost_usd: number;
		} | null;
		return row?.total_cost_usd ?? 0;
	}

	getCostEvents(sessionKey: string): CostEvent[] {
		return this.db
			.query("SELECT * FROM cost_events WHERE session_key = ? ORDER BY created_at DESC")
			.all(sessionKey) as CostEvent[];
	}
}

export type CostEvent = {
	id: number;
	session_key: string;
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
	model: string;
	created_at: string;
};
