## Plan: Tiered Inference Router (Ollama + Anthropic)

Implement a standalone inference router that selects between a local Ollama path and the existing Anthropic cloud path, while preserving the current Claude Agent SDK behavior for cloud requests and adding a separate, no-tool local response path for simple requests.

**Steps**
1. Phase 0, Fork and remote test-bed setup. Fork the repository, clone your fork, and run all implementation and validation against the bare-metal Phantom host at `10.0.0.154`. Nothing is built or validated on this local workstation.
2. Phase 1, Remote host discovery. Before code changes, confirm the live checkout path, branch, runtime mode (`systemd`, `nohup`, `tmux`, or similar), config files in use, environment source, Ollama model availability, health output, logs, and restart-deploy procedure on `10.0.0.154`.
3. Phase 1.5, Ollama generation model provisioning on host. Install the local generation models required by the router on `10.0.0.154`: required `llama3.1:8b`, optional fallback `mistral:7b`, while keeping `nomic-embed-text` for embeddings. Verify model pull success and warm-load before routing tests.
4. Phase 2, Config surface and types. Extend config schema and loader to support `INFERENCE_MODE`, `OLLAMA_AGENT_MODEL`, `LOCAL_COMPLEXITY_THRESHOLD`, and `LOCAL_TIMEOUT_MS`, with defaults `auto`, `llama3.1:8b`, `500`, and `30000`. Keep existing `PHANTOM_MODEL` behavior unchanged.
5. Phase 3, Interface contracts before TDD. Define the router decision interface, the hybrid local-classifier contract, the normalized local adapter error interface, the runtime provider-selection seam, and the response metadata/cost semantics for `local`, `cloud`, and `local->cloud fallback` outcomes.
6. Phase 4, TDD for routing contracts. Add tests first for routing heuristics, hybrid classifier tie-break behavior, normalized adapter errors, metadata override behavior, no-tool local-path behavior, and fallback-facing metadata generation.
7. Phase 5, Router and provider seam implementation. Implement `InferenceRouter` plus a small provider-selection seam in `AgentRuntime` so selection happens before the existing Anthropic SDK query path is invoked. Keep selection logic pure and mockable.
8. Phase 6, Local Ollama adapter. Implement a small local inference adapter with timeout support and a normalized `LocalInferenceError` contract. All timeout, 503, model-not-found, malformed-response, and network failures map into the same fallback-facing error shape.
9. Phase 7, Runtime integration and fallback. Integrate routing into `AgentRuntime`. In `auto` mode, run local only for eligible requests, then fallback to cloud on local timeout-error. In `local` mode, attempt local first and fallback to cloud. In `cloud` mode, keep the current Anthropic SDK path unchanged.
10. Phase 8, Metadata plumbing across call sites. Pass request options through `handleMessage()` using an optional request-options object rather than ad hoc extra parameters so all current call sites remain compatible, including index, scheduler, trigger, and MCP call sites.
11. Phase 9, Local prompt and UX alignment. Define a reduced local-tier prompt-profile that does not imply tool access. Ensure local-tier execution does not emit misleading tool-use or progress-stream behavior.
12. Phase 10, Logging and observability. Add structured logs showing routing decision, selected tier, selected model, reason, fallback occurrence, and whether the final answer came from local or cloud.
13. Phase 11, Protect cloud-only judge behavior. Add an explicit guard test confirming self-evolution judges remain cloud-only. Judges already use the raw Anthropic SDK, so the main requirement is preventing future router leakage into that path.
14. Phase 12, Regression and compatibility validation. Add tests for config loading, runtime behavior, metadata override handling, local-path no-tool semantics, local-to-cloud fallback semantics, event semantics, and cost semantics.

**Relevant files**
- `src/agent/runtime.ts` — add provider selection seam, fallback handling, optional request-options plumbing, and local-cloud event semantics.
- `src/agent/events.ts` — define response metadata and event semantics for local, cloud, and fallback outcomes.
- `src/agent/inference-router.ts` — standalone routing classifier and decision output.
- `src/agent/local-classifier.ts` — tiny local classifier used only when heuristics are inconclusive.
- `src/agent/local-inference.ts` — local Ollama adapter with timeout and normalized response path.
- `src/agent/local-inference-error.ts` — normalized local adapter error type and mapper.
- `src/agent/local-prompt.ts` — reduced local-tier prompt-profile that does not imply tool access.
- `src/agent/__tests__/inference-router.test.ts` — routing heuristics and hybrid-classifier TDD suite.
- `src/agent/__tests__/runtime-inference-routing.test.ts` — runtime-level tests for fallback, metadata override, local-path event semantics, and no-tool execution.
- `src/agent/__tests__/local-inference-error.test.ts` — normalization tests for timeout, 503, model-not-found, malformed response, and network failures.
- `src/config/schemas.ts` — add inference config fields.
- `src/config/types.ts` — inferred type updates from schema changes.
- `src/config/loader.ts` — env override parsing and defaults.
- `src/config/__tests__/loader.test.ts` — tests for inference env defaults and overrides.
- `src/channels/types.ts` — metadata typing contract.
- `src/index.ts` — pass inbound request options-metadata into runtime.
- `src/core/server.ts` — preserve compatibility for trigger-originated requests if `handleMessage()` shape changes.
- `src/scheduler/service.ts` — preserve compatibility for scheduled task requests if `handleMessage()` shape changes.
- `src/mcp/tools-universal.ts` — preserve compatibility for MCP `phantom_ask` flow.
- `src/mcp/tools-swe.ts` — preserve compatibility for MCP review flow.
- `src/agent/prompt-assembler.ts` — confirm cloud-prompt reuse boundaries and local prompt split.
- `src/agent/cost-tracker.ts` — define how local responses skip cost events while fallback-cloud responses still record cloud cost.
- `src/evolution/judges/client.ts` — reference point for cloud-only judge isolation.
- `config/phantom.yaml` — document inference defaults.
- `.env.example` — document new variables if the file exists in the fork or is added as part of docs.
- `docs/architecture.md` and-or `README.md` — document routing, fallback semantics, and local-tier limitations.

**Remote access, tools, and host discovery requirements**
- SSH access to `10.0.0.154` with the account that owns the running Phantom deployment.
- Git access to your fork so the host can fetch or pull the feature branch.
- Prefer non-interactive remote tooling already consistent with this repo: `ssh`, `scp`, and `rsync`.
- Helpful local tooling: GitHub fork access, SSH client, and optionally VS Code Remote - SSH.
- Windows note: ensure `C:\Users\Chris\.ssh\config` has a host entry for `10.0.0.154` with `IdentityFile ~/.ssh/id_ed25519_phantom` and `IdentitiesOnly yes` so PowerShell does not fall back to password auth.
- Confirm on host: `git` and `bun` availability, live checkout path, runtime mode, active config source, health output, logs, installed Ollama models, current Anthropic model, and safe restart-deploy procedure.
- Preferred host inspection commands: `pwd`, `git remote -v`, `git branch --show-current`, `git status --short`, `ps`, `pgrep`, `systemctl status <service>`, `journalctl -u <service> -n 100`, `curl -s http://localhost:3100/health`, `tail -100 <logfile>`, `cat config/phantom.yaml`, and `ollama list`.
- Preferred host model provisioning commands: `ollama pull llama3.1:8b`, optional `ollama pull mistral:7b`, `ollama list`, and one quick generation warm-up request against the selected model.
- Constraint: gather host configuration and runtime state from the remote node itself before validation. Do not assume the local workspace matches the running host.

**Normalized adapter error interface**
- Name: `LocalInferenceError`
- Purpose: single fallback-facing error shape for all local adapter failures.
- Required fields:
- `kind`: always `local_inference_error`
- `category`: `timeout`, `service_unavailable`, `model_not_found`, `malformed_response`, `network`, or `unknown`
- `retryable`: boolean
- `provider`: always `ollama`
- `model`: string
- `statusCode`: number or null
- `message`: sanitized human-readable summary
- `cause`: original error object or string for diagnostics only
- Rule: fallback logic branches only on normalized fields, never raw Ollama or transport-specific error shapes.

**Verification**
1. Fork the upstream repo, clone your fork, and create a working branch.
2. Confirm remote host readiness on `10.0.0.154`: SSH access, checkout path, runtime mode, active config source, installed Ollama models, logs, health output, and restart procedure.
3. Install and verify local generation models on host: required `llama3.1:8b`, optional `mistral:7b`, then confirm they appear in `ollama list`.
4. Run targeted routing TDD first.
5. Run runtime integration tests covering metadata override, no-tool local path, and fallback behavior.
6. Run local adapter error normalization tests.
7. Run config regression tests.
8. Run full test suite.
9. Run lint and typecheck.
10. Perform remote smoke checks on `10.0.0.154`:
- `INFERENCE_MODE=cloud` always uses existing Anthropic path.
- `INFERENCE_MODE=local` uses local for simple requests and falls back to cloud on local failure.
- `INFERENCE_MODE=auto` uses heuristics first, then the tiny local classifier only for ambiguous cases.
- metadata override `forceInferenceMode=cloud|local|auto` takes precedence.
- local-tier responses do not emit misleading tool-progress behavior.
- local-only responses create no cost event; local->cloud fallback records only the final cloud cost event.

**Decisions**
- Per-request override is passed via message metadata using an optional request-options object in runtime plumbing.
- Routing is hybrid: heuristics first, then a tiny local classifier only when heuristics are inconclusive.
- Local tier uses a reduced local prompt-profile rather than the full cloud prompt.
- Anthropic remains the authoritative fallback and the default complex-task engine.
- Self-evolution judges remain cloud-only.
- Heuristic keyword set includes at least `build`, `install`, `analyze`, `plan`, and `execute` as cloud signals.
- Complexity threshold uses integer token estimate with default `500`.
- Local-only responses do not write cost events; fallback-cloud responses write only the final cloud cost event.
- Implementation happens in your fork first, and validation happens only against the running bare-metal host `10.0.0.154`.

**Scope boundaries**
- Included: request routing for the interactive agent inference path, metadata-based force mode, hybrid classifier behavior, local prompt split, normalized local errors, and local->cloud fallback semantics.
- Included: runtime-event-cost semantics for local, cloud, and fallback outcomes.
- Excluded: replacing evolution judge provider.
- Excluded: changing embedding behavior.
- Excluded: infra deployment changes and host service-management changes.

**Further considerations**
1. Keep `llama3.1:8b` as the default local model with optional override to `mistral:7b`.
2. If strict local-only behavior is later required, add a separate `local_strict` mode rather than weakening fallback guarantees.
3. If the reduced local prompt still performs poorly, a follow-up optimization phase can tune local prompt size and classifier aggressiveness.