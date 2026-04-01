## Plan: Tiered Inference Router (Ollama + Anthropic)

Implement a standalone inference router that decides local vs cloud per request, defaults to auto mode, preserves current Anthropic behavior as fallback, and is introduced with TDD-first tests for deterministic routing heuristics and failure fallback.

**Steps**
1. Phase 0, Fork and remote test-bed setup (*blocks all implementation work*): fork the repository, clone your fork, and run all implementation and validation against your running Phantom instance on the bare-metal host `10.0.0.154`. Nothing is built or validated on this local workstation.
2. Phase 1, Config surface and types (*depends on 0*): extend config schema and loader to support `INFERENCE_MODE`, `OLLAMA_AGENT_MODEL`, `LOCAL_COMPLEXITY_THRESHOLD`, and `LOCAL_TIMEOUT_MS`, with defaults `auto`, `llama3.1:8b`, `500`, and `30000` respectively. Keep existing `PHANTOM_MODEL` semantics unchanged.
3. Phase 2, TDD for standalone router (*depends on 1*): add a new test suite for a router module that only performs decisioning and routing metadata generation (no SDK calls). Test matrix includes mode forcing, conversational/local routing, keyword/cloud routing, threshold boundaries, and high-consequence forcing.
4. Phase 3, Router module implementation (*depends on 2*): implement `InferenceRouter` as a pure/standalone module with typed input/output and classifier heuristics. Include a local token estimate helper and deterministic reasons in results for logging and assertions.
5. Phase 4, Local Ollama inference client (*parallel with 3 once interfaces are fixed*): create a small local inference adapter with timeout support and a normalized error contract before fallback. All local failures (timeout, upstream 503, model not found, malformed response) must map into one unified adapter error type consumed by Phase 5 fallback logic. Keep transport minimal and isolated from runtime orchestration.
6. Phase 5, Runtime integration with fallback (*depends on 3 and 4*): integrate router into `AgentRuntime` flow. In `auto` mode, run local tier for eligible requests, then fallback to cloud on local timeout/error. In `local` mode, attempt local first and fallback to cloud (per requirement). In `cloud` mode, keep current Anthropic path unchanged.
7. Phase 6, Per-request override plumbing via metadata (*depends on 5*): pass message metadata through runtime entrypoint so router can honor explicit `forceInferenceMode` (`local|cloud|auto`) from channel payload metadata.
8. Phase 7, Logging and observability (*depends on 5*): add structured logs at decision and completion points showing selected tier, model, reason, and fallback occurrence. Ensure logs are visible for every handled request.
9. Phase 8, Protect evolution/judge cloud-only behavior (*depends on 5*): verify no routing is applied to evolution judges and self-evolution remains Anthropic-only.
10. Phase 9, Regression and compatibility tests (*depends on 6-8*): update/add tests for config loading, runtime behavior, fallback behavior, and that existing cloud path still works when local tier is disabled/unavailable.

**Relevant files**
- `src/agent/runtime.ts` — integration point for routing decision, provider selection, local timeout handling, and cloud fallback.
- `src/agent/events.ts` — extend response metadata if needed to carry tier/model/log info safely.
- `src/agent/inference-router.ts` (new) — standalone routing classifier and decision output.
- `src/agent/local-inference.ts` (new) — local Ollama request adapter with timeout and normalized result.
- `src/agent/local-inference-error.ts` (new) — shared adapter error type and mapper from raw Ollama/network failures to one normalized fallback-facing error contract.
- `src/agent/__tests__/inference-router.test.ts` (new) — TDD-first unit suite for routing heuristics and mode forcing.
- `src/agent/__tests__/runtime-inference-routing.test.ts` (new) — runtime-level tests for fallback and metadata override behavior.
- `src/config/schemas.ts` — add new inference settings to `PhantomConfigSchema`.
- `src/config/types.ts` — type inference updates from schema additions.
- `src/config/loader.ts` — env parsing/override logic for new variables with defaults and validation.
- `src/config/__tests__/loader.test.ts` — tests for env overrides and defaults for new inference vars.
- `src/channels/types.ts` — keep/confirm metadata typing contract used for per-request override.
- `src/index.ts` — pass inbound message metadata through runtime entrypoint.
- `config/phantom.yaml` — add documented defaults for inference block.
- `.env.example` (if present in workspace root) — document new variables for operators.
- `docs/architecture.md` and/or `README.md` — document tiered routing behavior and fallback semantics.

**Remote access, tools, and host discovery requirements for bare-metal host `10.0.0.154`**
- Access method:
	- SSH access to `10.0.0.154` with the account that owns the running Phantom deployment.
	- Git remote configured to push your fork branch and pull it on the remote node.
	- Prefer non-interactive sync/deploy tools already used in this repo: `ssh`, `scp`, and `rsync`.
- Recommended local tooling:
	- GitHub fork access for your forked repository.
	- SSH client with working key auth to `10.0.0.154`.
	- Optional but useful: VS Code Remote - SSH extension for direct remote editing and inspection.
	- Optional but useful: system service inspection tools on the remote host (`systemctl`, `journalctl`) if Phantom is managed as a service.
- Required remote host capabilities to confirm before implementation:
	- `git` and `bun` installed and working.
	- Running Phantom deployment path confirmed on the host.
	- Ability to inspect process/service logs and health endpoints.
- Host information to gather before coding against the test bed:
	- Current checkout path, branch, and remote origin on `10.0.0.154`.
	- Whether Phantom is running via `systemd`, `nohup bun run src/index.ts`, `tmux`/`screen`, or another process manager.
	- Current Phantom config files in use: `config/phantom.yaml`, `config/channels.yaml`, `config/mcp.yaml`.
	- Current environment source in use: `.env`, `.env.local`, shell profile, or systemd environment.
	- Active health output from `/health` and current runtime logs.
	- Ollama availability on the host, installed models, and whether the local inference model must be pulled.
	- Current Anthropic model setting and any custom Phantom settings already present on the host.
	- Writable deploy/update path for pushing your fork branch and restarting the service safely.
- Preferred host inspection commands once remote access is available:
	- `pwd`, `git remote -v`, `git branch --show-current`, `git status --short`
	- `ps`, `pgrep`, `systemctl status <service>`, or `journalctl -u <service> -n 100` depending on how Phantom is run
	- `curl -s http://localhost:3100/health`
	- `journalctl -u <service> -n 100`, `tail -100 /tmp/phantom.log`, or the active log path in use
	- `cat config/phantom.yaml` and related config inspection with secrets handled carefully
	- `ollama list` to confirm local model availability
- Constraint:
	- Gather host configuration and runtime state from the remote node itself before implementation validation. Do not assume the local workspace or local env files match the running test bed.

**Normalized adapter error interface (defined before Phase 4 implementation)**
- Name: `LocalInferenceError`
- Purpose: single fallback-facing error shape for all local adapter failures
- Required fields:
	- `kind`: always `local_inference_error`
	- `category`: one of `timeout`, `service_unavailable`, `model_not_found`, `malformed_response`, `network`, `unknown`
	- `retryable`: boolean
	- `provider`: always `ollama`
	- `model`: string
	- `statusCode`: number or null
	- `message`: sanitized human-readable summary
	- `cause`: original error object or string for diagnostics (never shown to end users)
- Rule: Phase 5 fallback trigger logic branches only on `kind` and `retryable`, never on raw transport-specific error shapes.

**Verification**
1. Fork and clone flow:
- Fork the upstream `ghostwright/phantom` repository to your account.
- Clone your fork and create a working branch for this feature.
2. Remote-only execution policy:
- Build, run, and test only on the running bare-metal Phantom test bed at `10.0.0.154`.
- Do not run implementation builds on this local workstation.
3. Remote access readiness check:
- Confirm SSH access, remote checkout path, runtime mode (systemd vs direct Bun), and current host config before implementation begins.
4. Host discovery pass on `10.0.0.154`:
- Capture health output, recent logs, active config source, installed Ollama models, and deploy/restart procedure for this specific host.
5. Run targeted TDD suite first: `bun test src/agent/__tests__/inference-router.test.ts`.
6. Run runtime integration tests: `bun test src/agent/__tests__/runtime-inference-routing.test.ts`.
7. Run adapter error normalization tests: verify timeout, 503, model-not-found, and malformed response all produce the same adapter error type and reliably trigger cloud fallback.
8. Run config regression tests: `bun test src/config/__tests__/loader.test.ts`.
9. Run full suite: `bun test`.
10. Run static checks: `bun run lint` and `bun run typecheck`.
11. Manual smoke checks on `10.0.0.154`:
- `INFERENCE_MODE=cloud`: requests always use Anthropic existing path.
- `INFERENCE_MODE=local`: simple requests use local; local timeout/error falls back to cloud.
- `INFERENCE_MODE=auto`: conversational/simple routes local, keyword/complex/high-consequence routes cloud.
- metadata override `forceInferenceMode=cloud|local` takes precedence per request.

**Decisions**
- Per-request override will be passed via message metadata (user-selected), not via text command parsing.
- Anthropic path remains authoritative fallback and default complex-task engine.
- Self-evolution judges remain cloud-only and are explicitly out of router scope.
- Heuristic keyword set includes at least: build, install, analyze, plan, execute -> cloud.
- Complexity threshold uses token estimate integer with default 500 as requested.
- Fork-first workflow: implementation is done in your fork before any upstream PR.
- Remote-only build/test workflow: all build and validation activity uses the running bare-metal Phantom environment at `10.0.0.154`.
- Host-state-first workflow: remote runtime configuration, installed models, and service management method are discovered from `10.0.0.154` before implementation validation.

**Scope boundaries**
- Included: request routing for interactive agent inference path and metadata-based force mode.
- Included: local tier timeout/error fallback to cloud.
- Excluded: replacing evolution judge model/provider.
- Excluded: changing embedding pipeline (Ollama embeddings remain as-is).
- Excluded: infra deployment changes and host service management changes.

**Further considerations**
1. Local model default choice in code: keep `llama3.1:8b` primary with optional override to `mistral:7b`.
2. Fallback behavior on explicit `local` mode: current plan keeps cloud fallback enabled to satisfy your requirement; if strict local-only is later needed, add `INFERENCE_MODE=local_strict` in a follow-up.
3. Optional follow-up metric: add per-tier counters in existing metrics store for long-term routing quality analysis.