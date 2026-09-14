# Reproduce the demo

Use the included [dummy portal](../dummy/README.md), not a live institution. The captured artifact declares `http://127.0.0.1:7311`; use that port for this example.

## 1. Start a fresh portal

Requires Python 3.12+ and uv. From the repository root, in terminal A:

```sh
cd dummy
uv sync --locked
uv run python run.py --instance-dir fixtures/evidence-review --port 7311
```

The first use of that directory creates the synthetic baseline. Reusing it preserves its state; use a new directory name for another baseline. Sign in through awl's browser using the **teller** training operator documented in the [portal README](../dummy/README.md#training-operators). Do not put its password in chat or recordings.

## 2. Build awl

Requires Node.js 22.12+ and npm. From the repository root, in terminal B:

```sh
npm ci
npm run build
```

This builds the application; it does not run the test suite.

## 3A. Repeat genuine discovery, then replay what it creates

Put your API key in the root `.env`, as described in the [main README](../README.md#run-locally). Then launch an empty, isolated awl profile:

```sh
node evidence/launch.mjs fresh
```

The launcher installs a private copy of the recorded policy, selects Terra, and starts the real desktop app. It creates no chat results or capabilities. It does not submit prompts automatically. `AWL_AI_DISABLED` must not be set to `1` for this path.

In **New agent**, paste the [exact recorded goal](discovery/goal.txt):

```text
Open http://127.0.0.1:7311 and look up member 12345. Read the available USD balance of checking account 12345-00 from the Share register. Return only the member number, account number, and balance. Do not modify records or move funds. Ask me to sign in privately if needed.
```

When awl requests sign-in, complete it in the browser and select **Resume**. After the lookup completes, send the [exact save request](discovery/save-request.txt). A new discovery is model-driven and may produce different wording or a different draft; the historical example in this directory is not substituted for it.

In **Capabilities**, inspect the newly generated contract and validate it with two different input sets. If it uses the recorded parameter names:

| Case | `member_number` | `account_number` |
| --- | --- | --- |
| Validation A | `12345` | `12345-00` |
| Validation B | `12348` | `12348-00` |
| Replay | `12349` | `12349-00` |
| Missing-account replay | `12345` | `12345-99` |

For the current validation-counter issue, launch validation A, sign in when asked, and leave it paused. Launch validation B and sign in there too. Resume B to completion, then select A's chat and resume it to completion. Both completed cases can now accumulate without a later authentication pause clearing the first.

Once **Run** is available, invoke the new capability with the replay inputs. Sign in when asked, then resume. If the generated draft differs, use its actual declared inputs and inspect its behavior rather than assuming it matches the captured example.

## 3B. Replay the exact captured artifact without a model

This alternative needs no OpenAI key:

```sh
node evidence/launch.mjs captured --no-model
```

The launcher copies only the published capability, generated code, original validation sidecar, and policy into a **new isolated profile**. It imports the historical validation record so the recorded capability is available under **Run**. This is not a new validation, and it does not restore recorded chats, results, cookies, or authentication.

Open **Capabilities → Read checking balance**, supply `12349` and `12349-00`, then select **Run**. The new run should pause at sign-in. Complete the browser sign-in, select **Resume**, and inspect its final checkpoint and returned register text. The original successful replay is documented separately in [replay/events.jsonl](replay/events.jsonl).

Repeat **Run** with `12345` and `12345-99` to exercise the absent-account checkpoint. The captured behavior is a `TARGET_MISSING` failure at step 10, followed by **Needs you**, not a successful empty result.

To try explicit model-assisted repair, use `node evidence/launch.mjs captured` with an API key instead of `--no-model`, recreate the failure, and select **Repair with awl**. The deterministic executor never starts repair automatically. Any revised capability must be validated separately.

## Isolation and review

Each launcher invocation creates a different ignored directory under `evidence/.local/` and prints its path. It never writes to the user's normal awl profile or the checked-in evidence files. Browser logins remain per-session and ephemeral. Closing the demo window exits that isolated app. `--no-model` disables the model client and workspace persistence; inspect that run in the UI before closing it.

The launcher is a reviewer convenience added when packaging these records. It was not used to manufacture the historical logs and does not run tests, browser actions, or model requests itself. The recorded demo used the same application with a separate isolated profile. Test suites remain assigned to GitHub CI.

From the repository root, inspect the published-file checksums without launching the app:

```sh
cd evidence
shasum -a 256 -c SHA256SUMS
```
