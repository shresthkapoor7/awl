# awl

Computer use that learns a workflow, turns it into a capability, and asks for help when it needs you.

Many applications expose useful operations only through their interface. People repeat the same searches and forms by hand; an AI agent can navigate them, but reasoning through every repeat adds cost, latency, and variability. awl connects discovery, human demonstration, deterministic execution, and repair in one local desktop workspace.

## Run locally

Requires Node.js 22.12+ and npm. Electron is a project dependency.

```sh
npm ci
npm run dev
```

Set `OPENAI_API_KEY` in a project-root `.env` and restart Electron. Discovery and repair use the official OpenAI SDK with `gpt-5.6-terra`; `OPENAI_MODEL` overrides the model. The key stays in the main process. Validating and running saved capabilities does not require an API key.

Renderer edits reload during development. Restart `npm run dev` after changing Electron or preload code. `npm start` builds and launches the app; `npm run dev:web` previews only the renderer. On macOS, the launcher prepares a cached awl.app with its own menu-bar and Dock identity.

## The workflow

1. **Discover.** Give a website and a goal in chat. Watch the agent use the actual Chromium browser beside the conversation.
2. **Help.** A structured question pauses the agent and transfers the same session to you. Authentication happens directly in the browser. Select Resume to allow a fresh observation and continue. Stop prevents further scheduling; it cannot undo an action already dispatched.
3. **Teach.** Select Record and demonstrate a workflow. Recording continues across navigation and page updates. Pause for private interaction; select Stop & build when finished. awl infers parameters and starts drafting the capability automatically. The captured steps remain available to inspect.
4. **Validate.** Review the versioned contract in Capabilities and launch validation with explicit inputs. Parameterized capabilities require successful runs with two distinct input sets before Run appears. Each launch gets a new chat and browser session.
5. **Run.** The constrained executor navigates, resolves targets, performs declared operations, verifies the final checkpoint, and reads outputs. It has no model client, shell, or arbitrary script execution.
6. **Repair.** Missing or ambiguous targets and unexpected states pause execution. Resume checks the current page; an uncertain action requires explicit confirmation before advancing. Repair with awl explicitly reintroduces the model in the existing browser. It copies the pinned contract into the repair chat and writes new draft versions without modifying the original. Validate the correction before using it again.

Capabilities compile into a bounded operation plan and a readable JavaScript artifact. The runtime executes the validated plan directly; it does not evaluate generated JavaScript. Schema validation alone does not unlock execution.

## Workspace

Each chat has its own isolated browser session. Tabs, forms, cookies, and navigation survive view changes and renderer reloads. The optional 3D Overview projects actual run state; selecting an agent returns to its conversation. Completed tasks head to the water cooler; ending a model response alone does not mark a task complete.

Both side panels collapse and resize. Use **Cmd+B** for the left, **Cmd+Option+B** for the right, and **Cmd/Ctrl+L** for the browser address. The browser includes fullscreen, detached preview, device sizing, DevTools, zoom, appearance, and cookie/cache controls.

Run history plays back recorded events and retained screenshots. Playback never executes browser actions. Private intervals appear as gaps; events without images remain visible in the timeline.

## State and capture

Conversations, model history, reviewed recording state, and the bounded run journal are saved locally under the application's user-data directory. Writes are atomic. Restart restores conversations in private human control. Browser profiles, tabs, and authentication are deliberately ephemeral; restoring a transcript does not resume an interrupted capability or prove its last action succeeded.

Discovery observations are independent of demonstration recording. During private takeover, model observation is stopped. Recording excludes input from frames with detected password, OTP, or payment controls without ending the recording session. Capture resumes on safe pages; explicit Pause keeps capture off until you select Record again. Field detection uses semantic hints and is not a complete sensitive-data classifier: use private control for sensitive information it cannot recognize. Credentials never belong in chat or capability inputs.

The model receives accumulated conversation state with API storage disabled. Input token counts trigger supported compaction at 48,000 tokens. Pending questions, ownership, capability versions, and the journal remain outside the compacted context. The newest two screenshots remain in model context; the journal retains at most 20 exact tool results and four permitted screenshots for retrieval/history. Other journal metadata is capped at 2,000 events. A workspace currently supports 32 chats, with a 16 MB persistence limit per conversation.

Each model turn is bounded to 30 responses, 60 tool calls, and five minutes; individual tools have a 20-second deadline. Repeated identical results prompt a question. Deterministic steps have a 15-second deadline and never silently fall back to a model.

## Tools and targeting

The model can name chats, open/navigate browsers, manage tabs, capture screenshots, inspect DOM/frames, act on observed elements, wait for conditions, ask the user, verify completion, read retained evidence, and read/write capability drafts. Tools have strict schemas and per-chat scope. Actions consume snapshot references and reject stale or replaced nodes.

Reusable targets support unique CSS attributes, common native roles and accessible names, labels, placeholders, scoped text, supported frames, and open shadow roots. Ambiguity produces an error; the resolver does not pick the first match. Existing CSS-only drafts remain readable.

Current execution supports one tab and one declared origin per capability, with navigation, click, fill, select, key submission, text checkpoints, and string outputs. Recording is structured action capture, not continuous video. Actions are delivered through an isolated browser binding before navigation destroys the document, and hooks are installed in new documents. Frame inspection reconnects through page changes. Private gaps and unsupported targets remain visible evidence; the model must investigate missing steps rather than invent them. Recordings are bounded to 500 steps. Broader desktop control, persistent login profiles, downloads, and submission packaging remain outside this milestone.

## Checks

```sh
npm run build
npm run test:all
```

GitHub Actions runs the build and fixture tests on Linux and macOS for pull requests and feature-branch pushes. No API key is needed. Tests cover browser isolation, targeting, private capture, handoff/cancellation, recording, two-input validation, zero-model execution, explicit repair, context/restart handling, workspace UI, and office behavior. Linux tests run under Xvfb. Failure screenshots are uploaded as CI artifacts.

`npm run test:tools` and `npm run test:ui` run smaller suites. The optional `AWL_LIVE_TEST=1 node scripts/agent-live-check.mjs` uses the configured key and incurs API usage; build first.

### Browser policy

Set `AWL_POLICY_FILE` in `.env` to a reviewed JSON policy (see `policy.example.json`) and restart awl. Without a policy, automation has no permitted websites. Human browsing remains available. Origins are exact; paths are exact or end in `/*` for a subtree. Include legitimate authentication destinations and frame routes explicitly. Policy checks apply to discovery, validation, execution, and repair; the model cannot edit the policy.

Declare allowed action types and narrowly scoped `safeControls` for activating buttons or Enter submissions. Ordinary links must remain within allowed destinations. `blockedControls` and recognized consequential controls (posting, transfers, payments, deletion, authorization) require direct human operation even when a broad safe-control rule would match. Take over for the particular action, verify its result, then resume. The text classifier is conservative and incomplete: explicitly block application-specific risky controls. Do not allow an entire form or all buttons without reviewing their effects. The browser still runs the application's JavaScript; control policy is not a sandbox for arbitrary side effects inside a permitted application.

### Data retention

Authentication remains private. Identified personal fields (including common name/contact table columns and configured `sensitiveSelectors` in the browser policy) are redacted from DOM observations and saved text. Capability writes reject known private literals; use parameters and structural targets. Screenshot capture is refused when identified personal fields are visible. Detection is heuristic: configure selectors for the target application's PII and do not use real banking data to evaluate the prototype.

Raw tool history, opaque model compaction/reasoning, screenshots, and execution input/output values stay in memory and are omitted from workspace files. Restart rebuilds model context from redacted chat messages, not the original SDK history. Live outputs remain available to the caller during the run. Names and other unstructured personal data without recognizable metadata may evade detection; redacted text is not an assurance that arbitrary documents are safe to publish. Review any exported evidence before sharing it.
