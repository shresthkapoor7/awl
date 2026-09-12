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

Chat responses, handoff, and capability replay are still explicitly labeled demos. They do not control the live browser, call OpenAI, or generate automation code. Browser sessions are held in memory for the current app window and are cleared when it closes. Browser views survive a UI reload, but conversation demo state and newly created agent entries are not persisted yet; reload returns to the built-in demo agents.
The **Overview** tab shows the same demo agents in a 3D office. Select a workstation, its label, or an agent in the list to open the existing chat. Agents sit with articulated legs, type during replay, pace when waiting, and gather to gossip at the water cooler after completion. The room has warm wood, daylight, and leafy plants. Motion reflects the agent’s current state; the overview does not start extra work. The execution backend is not implemented yet.

## Run locally

Requires Node.js 22.12 or newer and npm. Electron is installed as a project dependency; a global installation is not needed. Its browser binary may download on the first launch. On macOS, the launch scripts create a cached **awl.app** runtime with its own identity for the menu bar and Dock. The cache lives in `node_modules/.cache/awl` and refreshes when Electron changes.

```sh
npm ci
npm run dev
```

To run the built UI in Electron:

```sh
npm start
```

For a UI-only preview, run `npm run dev:web` and open the local URL printed by Vite. The embedded browser requires Electron. Renderer changes reload automatically during `npm run dev`; restart that command after changing Electron or preload code.

## Explore the prototype

1. Enter a website address in the browser pane; use Back, Forward, Reload, and the tab controls to browse. Cmd/Ctrl+L focuses the address bar.
2. Switch agents to browse in another isolated session, then return to find your original page intact.
3. Open **Overview** or **Capability**, or collapse the browser, without losing the live session.
4. Use the chat's **Take control**, **Resume with awl**, and capability replay buttons to explore the separate demo flow. These buttons do not execute steps on your website.

Use the top-bar toggles to collapse either side panel, and drag their inner edges to resize them. Focused dividers also support arrow keys.

Web pages run sandboxed without Node or the app's IPC bridge. The browser supports HTTP/HTTPS navigation; downloads, external app links, and permission-dependent features such as camera or geolocation are not connected yet. Browser automation, recording, persistent profiles, and crash recovery are future work.
The office supports orbit, zoom, reset, and reduced motion. It stops rendering when closed or when the app is hidden. If WebGL is unavailable, the agent list remains usable. Scene assets ship locally.

## Checks

```sh
npm run build
npm run test:ui
```

The UI check launches Electron and exercises live browsing against a local test site, navigation, popup sign-in, session isolation, form preservation, tab lifecycle, native view bounds, error recovery, the demo chat flow, and the office overview. It requires a graphical desktop and writes screenshots to the ignored `test-results/` directory.
