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

Architecture and product planning. Implementation has not started.
