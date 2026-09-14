# awl — design report

awl turns a demonstrated browser workflow into a versioned capability: the model discovers, a human reviews, and a constrained executor replays. The [recorded example](evidence/README.md) uses a local synthetic member-servicing portal, including private sign-in, nested frames, two validation inputs, a third-member replay, and a missing-account failure. [Reproduction instructions](evidence/REPRODUCE.md) cover fresh discovery and replay of the captured artifact.

## Architecture

Electron owns browser sessions, model calls, policy, execution, and local storage. React presents chat and the same live browser through a narrow IPC bridge. Target pages have neither Node access nor application IPC. This keeps human takeover local and avoids coordinating separate automation and operator browsers. The trade-off is a substantial main-process coordinator; heavier workloads would need isolated workers.

Discovery and explicit repair use the official OpenAI SDK, with Terra as the default model. Strict tools expose observation, browser actions, capability writing, questions, and completion. Calls execute serially, bounded by response, tool, and time budgets. Replay uses a separate [executor](electron/executor.cts) with no model decision loop. Both paths share browser targeting, policy, and ownership checks.

SDK history stays in memory. Context budgeting requests compaction when needed and stops if compaction cannot fit the budget; ownership and execution state remain outside model context. Sanitized conversations and contracts persist as local JSON. Browser authentication is ephemeral. Local execution therefore does not mean offline discovery: permitted observations still go to the model provider.

## Artifact schema

The [version 3 contract](electron/tools/capability-write.cts) is independent of the transcript. It declares identity and version, origin, typed inputs, named outputs, ordered operations, reusable targets, a final text checkpoint, and optional exceptional-state handlers. Its seven operations are navigate, click, fill, select, press, extract text, and assert text. Inputs support strings, numbers, and booleans; extraction currently returns strings.

Targets carry CSS, role/name, label, placeholder, or text identity, with optional frame, shadow-host, and container scopes. Discovery references expire with their observation; saved targets must resolve again. This avoids persisting transient element handles. Named frames and semantic controls help on the fixture, but uniqueness alone does not establish stability across application versions.

Versions are immutable and writes check the expected previous version. Validation records bind to the artifact's content hash; parameterized plans require two distinct successful input sets before normal Run is enabled. This is a small generalization check, not a reliability guarantee. Generated JavaScript makes the plan reviewable; the runtime interprets the validated operations instead of evaluating that JavaScript.

The [saved example](evidence/capability/v1.json) takes member and account numbers and checks the requested account identity. Both outputs extract the full register body, so `available_usd` is **not** a scalar balance. The original artifact is preserved to expose this limitation.

## Determinism & error handling

A run pins its version, validates and binds inputs, resolves each target uniquely, and verifies the final checkpoint. Policy and ownership apply before action dispatch. Stale or ambiguous targets stop execution; there is no model-selected locator fallback. Steps have a 15-second deadline. Determinism describes the decision path, not a guarantee that a changing website always succeeds.

The [result contract](shared/execution.ts) separates `success` with outputs, a declared `business_outcome` with code/message/step, and `failure` with expected state, observed detail, and an uncertainty flag. Version 3 handlers recognize states at declared steps: return an outcome, fail explicitly, or perform bounded recovery such as waiting or acknowledging a known control. Recovery re-observes rather than blindly repeating the prior action. An uncertain dispatched action requires human confirmation and re-entry verification.

The evidence shows two completed validations and a successful third-member replay with register text containing `2.50`. The absent account `12345-99` instead produces [TARGET_MISSING](evidence/failure/result.json) at step 10 and pauses. This artifact declares no business-outcome or recovery handlers, so the recording does **not** demonstrate the full taxonomy. Journal events, a bounded failure DOM snapshot, and screenshots make the stopping point inspectable. Persisted executor outputs are redacted; the exported presentation values are explicitly derived from the saved chat message.

## Heterogeneity & multi-tenant

Implemented support is browser-specific: Chromium observation/actions, nested frames, and open shadow roots. The included portal deliberately uses legacy frame and form layouts. Closed shadow roots, canvas-only controls, and native desktop applications remain unsupported.

The extension seam is between the flow's contract and surface observation/action. A future adapter would expose observe, resolve, act, and verify with the same cancellation, policy, ownership, and uncertainty semantics. Native targets would add application/window identity and accessibility roles or anchored visual targets. Screenshot coordinates would need fresh anchors and post-action verification; raw recorded coordinates would not be portable. This requires a schema extension and adapter implementation, not merely swapping browser libraries.

For reuse across institutions, I would package a base workflow by vendor product and compatible version, separating tenant entry points, role mappings, and narrowly scoped target overrides. Overrides would be immutable derivatives linked to their base hash and validated per tenant. Runtime version/state checks would reject incompatible variants; ambiguous changes would pause for explicit repair. Credentials, sessions, policy, and private-value registries would remain tenant-isolated. A shared catalog could distribute contracts and validation metadata without sharing customer data. None of this tenant infrastructure is implemented today.

## Escalation & handoff

Blocked policy, authentication, unknown replay states, exhausted budgets, and explicit takeover stop automated scheduling. Execution mode, control owner, and capture state are separate. A pending request records the reason and relevant run context; the user operates the same live browser and explicitly resumes. Cancellation cannot undo an already dispatched action.

Private control suspends observation. Handoff/resume events and supplied explanations preserve context without recording credentials; private actions are intentionally not a complete click-by-click audit. Explicit teaching records permitted semantic actions across navigation, while private intervals remain gaps. Stop & build supplies that demonstration for capability drafting.

The recorded discovery and replay both resume after browser sign-in. A demonstration controller performed the human-side UI actions, including private credential entry and Resume. Later, explicit Repair inspected the failed account lookup and asked how absence should be handled. It did not silently substitute another account or finish a validated repair. Repair creates a separately validated draft while preserving the pinned original.

## Safety

Automation starts with no allowed destinations. Workspace policy specifies origins/routes, action types, scoped safe controls, explicit blocks, and sensitive selectors; per-chat read-only mode narrows it. Consequential controls are treated conservatively, and human intervention never becomes permanent permission. The [demo policy](evidence/policy.json) is published with the evidence.

Sensitive-page and personal-data screening cover supported frames and open shadow roots. Screenshot capture refuses identified private content. Known private values are redacted from saved text and rejected in capability literals. Persistence excludes raw model history, screenshots, browser profiles, and execution input/output objects. Sanitized chat can still contain output presentation text, as the synthetic example does; omitting structured outputs alone is not a privacy guarantee.

Detection is heuristic: unstructured PII, unsupported surfaces, or misleading metadata can evade it. An allowed site's JavaScript can also cause effects beyond the browser action policy. This is a guarded prototype, not a complete regulated-data boundary. Application-specific selectors, synthetic fixtures, and export review remain necessary.

## Cuts

I prioritized a real local browser loop and inspectable contracts over native desktop automation, tenant deployment, persistent logins, and downloads. Restart restores conversations in private human control, not browser state or an automatically resumed run. Two successful cases provide limited evidence; no broad reliability claim or independent network trace is included.

The next work is to narrow balance extraction, declare missing-account outcomes, and correct the validation-history reset caused by an authentication failure. Then I would complete and validate a repair version and collect genuine runs for declared recovery and permission denial. The current repair ends at a question, and the separate human-recording draft remains unvalidated. GitHub CI covers synthetic fixtures; those checks are distinct from the recorded discovery/replay evidence.
