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
3. **Teach.** Take control, select Record, and demonstrate a workflow. Pause for private interaction. Stop and review the ordered actions, remove accidental steps, and name non-sensitive parameters before asking awl to create a draft.
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

Discovery observations are independent of demonstration recording. During private takeover, model observation is stopped. Recording checks participating tabs and frames and pauses on detected password, OTP, or payment controls. Field detection uses semantic hints and is not a complete sensitive-data classifier: use private control for sensitive information it cannot recognize. Credentials never belong in chat or capability inputs.

The model receives accumulated conversation state with API storage disabled. Input token counts trigger supported compaction at 48,000 tokens. Pending questions, ownership, capability versions, and the journal remain outside the compacted context. The newest two screenshots remain in model context; the journal retains at most 20 exact tool results and four permitted screenshots for retrieval/history. Other journal metadata is capped at 2,000 events. A workspace currently supports 32 chats, with a 16 MB persistence limit per conversation.

Each model turn is bounded to 30 responses, 60 tool calls, and five minutes; individual tools have a 20-second deadline. Repeated identical results prompt a question. Deterministic steps have a 15-second deadline and never silently fall back to a model.

## Tools and targeting

The model can name chats, open/navigate browsers, manage tabs, capture screenshots, inspect DOM/frames, act on observed elements, wait for conditions, ask the user, verify completion, read retained evidence, and read/write capability drafts. Tools have strict schemas and per-chat scope. Actions consume snapshot references and reject stale or replaced nodes.

Reusable targets support unique CSS attributes, common native roles and accessible names, labels, placeholders, scoped text, supported frames, and open shadow roots. Ambiguity produces an error; the resolver does not pick the first match. Existing CSS-only drafts remain readable.

Current execution supports one tab and one declared origin per capability, with navigation, click, fill, select, key submission, text checkpoints, and string outputs. Recording is structured action capture, not continuous video. Navigation can interrupt event capture; review gaps and observed navigation rather than assuming every intermediate action was retained. Broader desktop control, persistent login profiles, downloads, and submission packaging remain outside this milestone.

## Checks

```sh
npm run build
npm run test:all
```

GitHub Actions runs the build and fixture tests on Linux and macOS for pull requests and feature-branch pushes. No API key is needed. Tests cover browser isolation, targeting, private capture, handoff/cancellation, recording, two-input validation, zero-model execution, explicit repair, context/restart handling, workspace UI, and office behavior. Linux tests run under Xvfb. Failure screenshots are uploaded as CI artifacts.

`npm run test:tools` and `npm run test:ui` run smaller suites. The optional `AWL_LIVE_TEST=1 node scripts/agent-live-check.mjs` uses the configured key and incurs API usage; build first.
