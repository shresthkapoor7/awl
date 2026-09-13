# awl

Computer use that learns a workflow, turns it into code, and asks for help when it needs you.

## The problem

Many applications expose their useful operations only through a user interface. People repeat the same searches, forms, and confirmation steps by hand. An AI agent can navigate those screens, but reasoning through a familiar task on every run adds cost, latency, and variability. Recorded automation also needs a way to handle unexpected states and learn from corrections.

awl is being built to connect discovery, reliable execution, and human help in one local workspace.

## The idea

Give awl a website and a goal in chat. It will work through the interface while you watch and control the same browser beside the conversation. When it gets stuck or needs authentication, you can take over, help it, and hand the session back.

A successful workflow becomes a reusable capability with defined inputs, outputs, and checks, compiled into executable code. Future runs use that code without an LLM in the execution loop. When an unfamiliar issue appears, you can bring the agent back to investigate and turn the correction into a validated new version.

An optional 3D office overview will show agents' activity and highlight where attention is needed. Chat and the live browser remain the main workspace.

## Direction

- Local desktop application and browser execution.
- OpenAI API and official SDK for discovery and repair.
- Explicit human takeover and resume within the same session.
- Versioned capabilities and deterministic execution.
- Learning from scoped corrections without storing credentials in workflows.

## Status

Electron workspace with a live embedded Chromium browser. Enter a website in the address bar and use it directly beside chat. Each agent has its own isolated browser session; tabs, forms, navigation history, and cookies stay alive when switching agents, collapsing the pane, or opening the office. Popups open as tabs in the same session, including opener-based sign-in flows.

New chats use GPT-5.6 Terra through the OpenAI Responses API and the official SDK. Terra can name a chat, open and navigate its browser, inspect DOM elements and frames, capture viewport screenshots, interact with controls, wait for page changes, and write/read versioned capability drafts. The workspace starts with an empty chat; messages, tool activity, and session status come from the live agent. Browser sessions are held in memory for the current app window and are cleared when it closes. Browser views survive a UI reload, and live chats reconnect to their in-memory state after a UI reload. Live conversations are not persisted across app restarts. Capability drafts are saved under the app’s local user-data directory.

The **Capabilities** tab lists saved capability drafts with their latest version and contract. Drafts are inspectable, but compilation and execution are not implemented yet.

The **Overview** tab shows the same sessions in a 3D office. Select a workstation, label, or list entry to open its existing chat. Agents work during a model turn, ask for attention when a turn stops or fails, and gather at the water cooler when a turn finishes. New sessions wait at their desks. The overview reflects session activity without starting extra work.

## Run locally

Requires Node.js 22.12 or newer and npm. Electron is installed as a project dependency; a global installation is not needed. Its browser binary may download on the first launch. On macOS, the launch scripts create a cached **awl.app** runtime with its own identity for the menu bar and Dock. The cache lives in `node_modules/.cache/awl` and refreshes when Electron changes.

```sh
npm ci
npm run dev
```

Set `OPENAI_API_KEY` in the ignored project-root `.env`, then restart Electron. Select **New agent** and send a website and a goal. The default model is `gpt-5.6-terra`; `OPENAI_MODEL` can override it. Credentials are read only in the main process. The UI-only preview cannot run the agent or embedded browser.

To run the built UI in Electron:

```sh
npm start
```

For a UI-only preview, run `npm run dev:web` and open the local URL printed by Vite. The embedded browser requires Electron. Renderer changes reload automatically during `npm run dev`; restart that command after changing Electron or preload code.

## Use the workspace

1. Enter a website address in the browser pane; use Back, Forward, Reload, and the tab controls to browse. Cmd/Ctrl+L focuses the address bar.
2. Switch agents to browse in another isolated session, then return to find your original page intact.
3. Send a goal in chat to start the agent; inspect its tool activity or select **Stop** to cancel further work.
4. Open **Overview** or **Capabilities**, or collapse the browser, without losing the live session.

Use the top-bar toggles to collapse either side panel, and drag their inner edges to resize them. Focused dividers also support arrow keys. Use **Cmd+B** for the left sidebar and **Cmd+Option+B** for the browser panel (**Ctrl+B** / **Ctrl+Alt+B** on Windows and Linux). Shortcuts also work while a browser tab has focus.

The browser’s **…** menu includes hard reload, DevTools for the active page, a separate preview window, device viewport controls, appearance, zoom, and per-agent cookie/cache clearing. Closing the separate preview returns the same live tab to the workspace. The expand button at the top fills the app with the browser; Escape restores the split view. Device presets, custom dimensions, and rotation preview responsive layouts without changing the session. Appearance follows System, Light, or Dark across the preview browsers; the workspace remains dark.

Web pages run sandboxed without Node or the app's IPC bridge. The browser supports HTTP/HTTPS navigation; downloads, external app links, and permission-dependent features such as camera or geolocation are not connected yet. Recording, deterministic replay, persistent browser profiles, and crash recovery are future work.
The office supports orbit, zoom, reset, and reduced motion. It stops rendering when closed or when the app is hidden. If WebGL is unavailable, the agent list remains usable. Scene assets ship locally.

## Checks

```sh
npm run build
npm run test:ui
npm run test:tools
```

The UI check launches Electron and exercises live browsing against a local test site, navigation, popup sign-in, session isolation, form preservation, tab lifecycle, native view bounds, error recovery, empty and live chat states, UI reloads, and the office overview. It requires a graphical desktop and writes screenshots to the ignored `test-results/` directory.

## Agent tools

| Tool                 | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `chat_set_name`      | Rename the current chat.                                                 |
| `browser_start`      | Open a website or navigate an explicit tab.                              |
| `browser_tabs`       | List, select, and close this chat’s tabs.                                |
| `browser_screenshot` | Capture a bounded viewport image for the model.                          |
| `browser_dom`        | Read visible text, frames, and controls with snapshot-scoped references. |
| `browser_action`     | Click, fill, select, press keys, or scroll an observed element.          |
| `browser_wait`       | Wait for visible text or a URL condition.                                |
| `capability_write`   | Validate and save an immutable, parameterized capability draft.          |
| `capability_read`    | List and inspect this chat’s saved drafts and versions.                  |

Tools use strict schemas, per-chat browser targets, structured errors, and time limits. Actions consume their DOM snapshot; stale or replaced targets require a fresh observation. Browser content is treated as untrusted input. Visible password fields and OTP/payment fields identified through autocomplete tokens, names, labels, or other semantic hints block observation; authentication must happen directly in the browser. This detection is conservative and is not a complete sensitive-data classifier.

Each turn allows up to 30 model responses, 60 tool calls, and five minutes. Tool calls have a 20-second deadline. Stop cancels further work; an action already dispatched may have taken effect, so inspect before repeating it. Screenshots stay in memory and are sent to OpenAI; only the newest two are retained in ongoing model context. Tools expose no arbitrary shell, filesystem, or JavaScript execution to the model.

Capability drafts contain typed inputs/outputs, observed selectors, ordered steps, and a final checkpoint. Draft selectors currently target the main document. Schema validation does not establish that a workflow is replayable: compilation, execution, repair, and promotion remain separate future work.

`npm run test:tools` uses local fixtures and a fake model client. The optional `AWL_LIVE_TEST=1 node scripts/agent-live-check.mjs` uses the configured API key and incurs API usage against a disposable local page; build first.
