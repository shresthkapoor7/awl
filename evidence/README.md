# Recorded end-to-end evidence

These are records of the **real September 14, 2026 demo**, using Terra through the official OpenAI SDK and a live local [Member Servicing Portal](../dummy/). They were exported from awl's persisted demo sessions after recording. They are not scripted model responses, unit-test results, or reconstructed event logs.

Start with the [capability](capability/v1.json), [discovery log](discovery/events.jsonl), and [successful replay log](replay/events.jsonl). [Reproduce the workflow](REPRODUCE.md) or [watch the 4:09 walkthrough](../docs/videos/awl-demo.mp4).

## The demonstrated thread

| Stage | What happened | Evidence |
| --- | --- | --- |
| Goal and discovery | Terra opened the portal, requested private sign-in, searched member `12345`, opened the record and nested Share register, and verified account `12345-00` with Available USD `2,450.75`. | [Exact goal](discovery/goal.txt), [messages](discovery/messages.json), [events](discovery/events.jsonl), [result screenshot](screenshots/discovery-result.png) |
| Saved capability | The model saved `read_checking_balance` v1 with two string inputs, two string outputs, frame-scoped targets, and an account-identity checkpoint. | [Original JSON](capability/v1.json), [generated JavaScript](capability/v1.mjs), [save request](discovery/save-request.txt) |
| Validation | The same artifact completed with members `12345` and `12348`. Both cases match the input fingerprints in its original validation sidecar. | [Cases and timestamps](validation/cases.json), [original validation record](capability/v1.validation.json) |
| Deterministic replay | The saved capability ran for member `12349` / account `12349-00`, passed all ten steps, and returned register text showing `2.50`. | [Invocation](replay/invocation.json), [events](replay/events.jsonl), [stored execution state](replay/session.json), [presented outputs](replay/presented-output.json), [result screenshot](screenshots/replay-result.png) |
| Failed replay | Member `12345` / account `12345-99` reached the register, but the requested account was absent. Step 10 timed out with `TARGET_MISSING`; execution paused and did not report success. | [Invocation](failure/invocation.json), [events](failure/events.jsonl), [structured failure](failure/result.json), [DOM structure](failure/dom-snapshot.json), [screenshot](screenshots/failure.png) |
| Explicit repair and handoff | A human entered Repair. Terra encountered an expired lease and a policy-blocked renewal control. After private human renewal, it inspected again and asked how to handle the missing account rather than replacing it. | [Repair events](repair/events.jsonl), [messages](repair/messages.json), [pending question and control state](repair/session.json), [question screenshot](screenshots/repair-question.png) |

The failure log ends at sequence **29**, before any repair model calls. Repair starts at sequence **30** in the same session. The successful replay has no model tool activity; its execution path is [`Execution`](../electron/executor.cts), which does not call the model. An independent network trace was not captured.

## What each file preserves

- `events.jsonl` contains the original journal entries with their sequence numbers, UTC timestamps, actors, action reasons or expected targets, and safe failure evidence. No events were invented or silently corrected.
- `messages.json` contains persisted user/assistant messages. It is the application conversation, not this development conversation and not private model reasoning.
- `session.json` contains selected fields of the persisted session. It is **not a browser profile** or an unredacted API trace. Session UUIDs and tool-call IDs are correlation identifiers, not authentication credentials.
- `invocation.json` records the synthetic input set separately, with its source. The app redacts execution inputs on disk; these exports do not overwrite those redactions. [Replay inputs](screenshots/replay-inputs.png) and [failure inputs](screenshots/failure-inputs.png) are visible in original recording frames.
- `presented-output.json` splits the output labels from the preserved `Capability` chat message. It is explicitly marked as derived presentation data. The runtime removes its structured execution outputs during persistence, so the original stored execution object still has an empty `outputs` field.
- The capability JSON, generated JavaScript, and validation sidecar are copied **byte for byte**. The immutable JSON remains `status: "draft"`; validation status is held separately and bound to the JSON's SHA-256 hash. The JavaScript is reviewable output; awl executes the constrained plan, not arbitrary artifact code.

[Manifest](manifest.json) records export provenance and requirement coverage. [Screenshot provenance](screenshots/provenance.json) records source media offsets and transformations. [SHA256SUMS](SHA256SUMS) covers this evidence directory; hashes establish file integrity, not an independent signature or proof of execution.

## Reading the logs

Discovery sequences 1–20 cover the live lookup; 21–25 cover capability creation. The model corrected three `INVALID_CAPABILITY` write attempts before saving. Those failures remain visible. The discovery session's final stored status is `idle` after saving; the earlier `task_complete` event and message record the successful lookup.

Replay sequences 5–8 record private authentication, transfer to the human, and resume. They remain in the log even though password entry is absent from the video. After step 10, the current journal labels its terminal cursor as “Step 11”; the execution state correctly records ten completed steps. The export preserves that display quirk.

The failure's `step: 9` is a zero-based index: the tenth and final action. Its stored `observed` detail is intentionally reduced by persistence. The richer signal is a three-frame DOM-structure capture plus the reviewed screenshot. DOM evidence omits text, values, URLs, and private fields; it does not attempt to reconstruct deleted observations.

## Handoff and safety

The [recorded policy](policy.json) permits the loopback portal and selected operations, with scoped safe controls, blocked posting/authorization controls, and a private-field selector. It is the policy actually used, including the unused S310 review-form allowance; it is not a universal policy recommendation.

The agent and the operator used the same live browser during each handoff. A demonstration controller entered synthetic credentials through the visible browser form while native capture was stopped. It also clicked Resume and operated the teaching example as the human operator. It did not make business HTTP calls, inject model completions, or mark runs successful. Each separately launched validation/replay used its own browser session.

No API key, password entry, cookie, token, signing key, database, `.env`, browser profile, or raw model context is included. Visible member identifiers and balances are synthetic fixture data. The frame images and edited video were reviewed for export. The original private fixture/profile remain excluded from the repository.

## Limits of this example

1. **Output targeting is broad.** Both declared outputs extract `body` from the nested register frame. `available_usd` therefore contains register text, not only a currency scalar. The artifact is retained as generated; it was not hand-edited to make the example look better.
2. **Authentication resets validation history.** A failed validation clears earlier passed cases. Both final validation sessions were authenticated before either was resumed to completion, allowing two genuine distinct cases to accumulate. The logs include both authentication failures and successful continuations.
3. **Missing account is currently a hard failure.** This artifact has no declared business-outcome or recovery handlers. `TARGET_MISSING` demonstrates conservative stopping and escalation, not a clean `account_not_found` business result or automatic recovery. The implementation's broader result taxonomy is not demonstrated by this one artifact.
4. **Repair stops at a real question.** No newly validated repair version is claimed. The separate human-recording draft shown in the video is also not the validated artifact used here.
5. **Targeting has assumptions.** Named frames, visible link/button names, and form-field names work on this legacy fixture. Selecting `input[name="row"]` relies on an exact member search returning one visible result. Missing/ambiguous matches pause; robustness across other portal versions is not established.
6. **Evidence is bounded.** Raw model requests/responses, full DOM observations, and network traces were not retained. The persisted journal and messages, original artifact, screenshots, and actual screen recording are the available evidence. More precise output extraction and outcome handling remain follow-up work.

This directory supplies the saved artifact and discovery/replay evidence requested for submission. It does not replace the separate design report or establish that every production requirement is complete.
