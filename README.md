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

Interactive Electron UI prototype. The workspace includes an agent sidebar, chat, a simulated browser, a human handoff, and a capability preview. All agent responses and browser content are sample data; no websites are visited, no AI calls are made, and no automation code is generated. Session changes stay in memory and reset on reload.

The 3D overview and execution backend are not implemented yet.

## Run locally

Requires Node.js 22.12 or newer and npm. Electron is installed as a project dependency; a global installation is not needed. Its browser binary may download on the first launch.

```sh
npm ci
npm run dev
```

To run the built UI in Electron:

```sh
npm start
```

For a browser-only preview, run `npm run dev:web` and open the local URL printed by Vite.

## Explore the prototype

1. Open **Member onboarding** and select **Take control**.
2. Check the member confirmation in the sample browser.
3. Select **Resume with awl** to see the completed workflow.
4. Open **Capability** and select **Try a replay** for the simulated replay state.

You can also switch agents, search sessions, create a new agent, and send messages to explore the conversation layout. Use the top-bar toggles to collapse either side panel, and drag their inner edges to resize them. Focused dividers also support arrow keys. The browser toolbar's reset button restarts the selected demo.

## Checks

```sh
npm run build
npm run test:ui
```

The UI check launches Electron and exercises takeover/resume, replay, session switching, chat, search, new sessions, panel resizing and collapse, and the compact layout. It requires a graphical desktop and writes screenshots to the ignored `test-results/` directory.
