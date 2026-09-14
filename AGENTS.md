# awl

awl is a local desktop application that learns browser workflows and turns them into reusable automation capabilities. Read [architecture.md](architecture.md) for the current implementation and its limits.

## Product direction

- Use the official OpenAI SDK for discovery and explicit repair. Default to `gpt-5.6-terra`, with model selection configurable per chat.
- Keep the application and browser local. Cloud execution, Docker, and messaging integrations are outside the current product scope.
- Chat and automation share the same interactive browser. Preserve tabs and task context during human takeover and resume; make control ownership explicit.
- Keep authentication in the browser. Exclude credentials and sensitive data from chat, recordings, capability artifacts, and logs. Pause sensitive observation during private interaction.
- Save typed, versioned capabilities with inputs, outputs, targets, checkpoints, and declared error handling. Execute the validated plan deterministically without model calls; generated code remains reviewable.
- Pause on unknown or uncertain outcomes. Model-assisted repair is a separate user action and produces a new draft requiring validation. One-time approvals never become permanent permissions.
- Derive the optional office overview from actual session activity. Selecting an agent opens its existing chat. View changes and visual history playback must not execute browser actions.

## UI

- Keep awl's own visual identity: readable typography, minimal repeated copy, and subtle borders.
- Use `#0a0a0a` for the main surfaces and `#212121` for user messages. Highlight the active session with a simple background, without a decorative rail.
- Keep both side panels collapsible and resizable, and recording controls consistently visible.

## Working rules

- Prepare changes for user review. **Do not commit or push until explicitly requested.**
- **Do not run tests locally.** Leave execution to GitHub CI unless the user explicitly asks otherwise.
- Do not use subagents or the Glyph skill.
- Follow the current request rather than restarting old roadmaps or adding unrelated features.
- When commits are authorized, make one commit per cohesive change. Use `awl: [type] message`, with a short, specific message; for example, `awl: [bug] keep recording controls inside the chat`.

## Documentation and repository hygiene

- Keep `AGENTS.md`, `architecture.md`, `the_assignment.pdf`, and local planning notes ignored and untracked unless the user explicitly changes their publication scope. Never force-add them.
- The README's architecture link is intentional for local review; `architecture.md` is not published yet.
- Check ignore rules and the Git index before staging. Ignore rules do not remove files already tracked.
- Keep the README focused on setup, the workflow, relevant screenshots, source links, and honest implementation limits. Distinguish interface examples and fixture checks from genuine discovery/replay evidence.
- Keep API keys, browser profiles, and private session data out of source control. Review screenshots and exported evidence before publication.
- Check licenses and preserve required attribution when reusing third-party code or assets. Removing reference-project discussion does not remove attribution obligations.
