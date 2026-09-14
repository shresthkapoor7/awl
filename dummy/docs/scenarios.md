# Portal workflow and fixture contracts

These describe the portal's observable behavior and the inputs used by its CI browser checks. They are not an automation capability, an LLM discovery transcript, or evidence that an external agent can replay the workflow.

## Baseline and starting state

Start a new fixture directory using `uv run python run.py --instance-dir fixtures/review-a --port 7311`. If that directory already exists, choose a new one. Open the printed origin and sign in through the browser using the training operator in the README. Start at the workstation bulletin as a servicing clerk. Never submit credentials as part of a conversational goal.

Each CI scenario uses a temporary SQLite database and a fresh browser context. For manual use, restarting an existing directory deliberately retains pending requests, opened accounts, contact revisions, and the journal. Check Work in process and the member's Share register before reusing existing state. There is no automatic reset.

## Primary workflow: prepare a savings share

Goal template:

> Find member {member_id}. Prepare a regular savings share named {description}, funded with {amount_usd} USD from account {source_account}. Stop at the saved review screen. Return the request reference, member number, share class, description, funding account, amount, and request state. Do not post the share or transfer funds.

| Input | First invocation | Alternate invocation |
| --- | --- | --- |
| Member number (string) | `12345` | `12348` |
| Product code (string) | `SAV` | `SAV` |
| Description (string) | `Rainy day` | `Trip fund` |
| Source account (string) | `12345-00` | `12348-00` |
| Amount USD (decimal string) | `25.00` | `40.50` |
| Initial source balance USD | `2,450.75` | `2,501.75` |

Both invocations may run on one initially fresh fixture, since they affect different members. Preparing the same product again for the same operator/member returns `SHR-09` until the existing request is cancelled or posted.

Use Member inquiry → exact member number → select the matching radio row → Process selected record → verify the member detail → Share maintenance → complete the form → Transmit for review.

The saved request must display all of the following:

| Output | Required observation |
| --- | --- |
| Request reference (string) | Nonempty generated reference in the Request reference row; currently `R` followed by ten uppercase hexadecimal characters. Capture it from the UI, never hard-code a previous value. |
| State (enum) | `REVIEW` |
| Member number and name | The requested member, with the corresponding name shown on the member detail and review. |
| Share class | `SAV / Regular savings` |
| Description | Exactly the supplied description |
| Debit account | Exactly the supplied source account |
| Opening funding USD | Exactly the supplied decimal amount; a calling contract may convert it to integer cents. |
| New account | Absent at review |

The checkpoint is **a saved request in REVIEW**, not an opened or funded account. Returning to Work in process must show its exact reference. The Share register must still show the original balance and no new savings account. A generic heading alone does not establish success or identity.

Posting is a separate scope: it requires the final authorization checkbox and POST SHARE + TRANSFER. Only a persisted `POSTED` receipt with a new account establishes that the transfer completed.

## Legacy screen boundaries

| Screen | Frame context | Targeting requirement |
| --- | --- | --- |
| Member inquiry `M100` | `work` | Associate index selection with its surrounding table text. Here `f01` is the inquiry value and `f02` is the index. |
| Search results | `work` | Find the row containing the supplied member number, then its radio control. `Reed` returns both 12345 and 12348. Do not select the first result by position. |
| Member detail `M200` | `work` | Verify member identity before continuing. |
| Share register `S100` | `work` → `register` | Select by the requested account identifier before Retrieve history. Navigation replaces the parent workspace. |
| Establish share `S310` | `work` | Here `f01` is product, `f02` description, `f03` funding account, `f04` amount, and `f05` member instruction. The same field names have different meanings on other screens. |
| Review `S320` | `work` | Read values from their named table rows and retain the generated request reference. |

Forms and frame documents are replaced by normal postbacks. Rediscover the current document and its current CSRF form after navigation. There are intentionally no test IDs, added accessibility shortcuts for business fields, or JSON business endpoints. The browser tests are scoped to their frames and visible record identity; they do not demonstrate an external agent's locator strategy.

## Business outcomes

Use a fresh fixture unless the row explicitly says otherwise. For opening failures, supply `SAV`, a description, `25.00`, the member's open checking account where available, and the member-instruction checkbox.

| Condition | Fixture or setup | Expected result and boundary |
| --- | --- | --- |
| No member | Exact inquiry `99999` | `MEM-01` on the inquiry screen, no selection rows; valid not-found result. |
| Closed member | `12347` | `MEM-04`; no request/account/transfer. The closed member has no selectable open funding account. |
| Insufficient funds | `12349` has 2.50 | `FUN-02` for the otherwise valid 25.00 deposit; no funds moved. |
| Already-open product | `12350` already has `SAV` | `SHR-08`; existing account is unchanged. |
| Pending request | Prepare `SAV` for 12345, then prepare again as the same operator | `SHR-09` includes the existing reference. Locate and verify that request instead of creating another. |
| Ambiguous surname | Search `Reed`, target `12348` | Select Sam Reed's row, not Avery Reed's; verify 12348 at detail and review. |
| Restricted member | `12346` | Preparing review is permitted. Posting returns `SEC-40` until a different supervisor signs this exact request. |
| Inquiry-only operator | Use the documented auditor | Read permitted; servicing mutations return `SEC-21`. |
| Stale reviewed record | Prepare review, change that member's contact details, try posting the old review | `MEM-09`; cancel the old request and prepare a new one. No blind retry of posting. |

## Recovery and authentication

Arm faults in Workstation diagnostics in the same browser session that will encounter them. Different sessions do not share armed faults.

- **Slow inquiry:** the next inquiry pauses for three seconds. The browser check allows eight seconds and submits once. A consumer should use its own explicit bounded wait.
- **Host failure:** the next inquiry returns HTTP 503 / `HOST-52`. Retrieve/retry that inquiry once, then enter the intended inputs. A second unexpected failure should be surfaced, not hidden by an unbounded retry loop.
- **Host bulletin:** acknowledge `MSG-17` to obtain a fresh inquiry form, then enter the intended inputs. The acknowledgment itself must not produce a missing-query validation error.
- **Access expiry:** Renew session in the browser. Previously unsubmitted form values are not retained; re-enter them after verifying the screen. Saved requests remain available by reference.
- **Full session expiry:** a person signs in through the same browser. Resume only after locating the intended request or screen. Authentication values belong in browser forms, not capability inputs or recordings.
- **Supervisor authorization:** enter the supervisor's credentials in the request-specific authorization screen. The original clerk remains signed in. The authorization applies to that request only; a later request needs its own authorization.
- **Lost posting response:** on a successfully committed posting, `HOST-71` / HTTP 503 replaces the response. Retrieve that request first. A `POSTED` receipt and account history establish completion; do not infer failure from the HTTP status or open another request to compensate.

Member pages intentionally display synthetic names and contact details. A consumer remains responsible for redacting those observations and pausing sensitive capture during sign-on and supervisor authorization.
