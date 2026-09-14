# Meridian Member Services

This directory contains the source of the local portal used in awl's demo. It is part of the awl checkout, with no nested Git repository, copied working database, or private session data.

A fictional credit-union back-office portal for testing computer-use automation against an awkward, stateful business application. It runs locally, stores its records in SQLite, and exposes its workflows through rendered HTML and browser form submissions.

The interface is intentionally old-fashioned: dense tables, numeric function codes, unlabeled business fields, opaque field names, explicit row selection, nested frames, and full-page navigation. There are no test IDs, JSON business APIs, GraphQL endpoints, or automation backdoors. Like any web application, its HTML forms still use HTTP; this is not a claim that form requests cannot be reproduced by an HTTP client.

## Run

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```sh
uv sync --locked
uv run python run.py
```

Open **http://127.0.0.1:7310**. The server binds only to loopback. To use another port:

```sh
uv run python run.py --port 7311
```

The first start creates `instance/meridian.sqlite3` and a local signing key. Subsequent starts preserve members, accounts, requests, notes, sessions, and the activity journal. Stop with Ctrl+C. No external service or API key is required.

## Independent fixture instances

Use a new directory for a fresh baseline without deleting the working database:

```sh
uv run python run.py --instance-dir fixtures/review-a --port 7311
```

Open `http://127.0.0.1:7311`. The first start of that directory seeds the original records. Restarting the same command resumes its saved state; it does **not** reset it. Use another unused directory, such as `fixtures/review-b`, for another fresh baseline. Relative directories resolve from the current working directory. Both the database and signing key live in the selected directory. The CLI prints that directory at startup.

Separate fixture directories also use separate cookie names, so two instances on different ports do not overwrite each other's sign-in cookies in the same browser. Do not serve the same fixture directory on multiple ports: that intentionally shares both data and sessions. The default remains `instance/` on port 7310. The `fixtures/` and `instance/` directories are ignored by Git.

Fixture initialization creates synthetic starting state only. All member servicing must still happen through the rendered UI. There is no reset endpoint or command that silently deletes existing records.

## Training operators

These are public fixture credentials for this local fictional system only:

| Operator | Password | Authority |
| --- | --- | --- |
| `teller` | `Teller-demo-42!` | Member servicing; prepares and posts own requests |
| `supervisor` | `Supervisor-demo-42!` | Servicing, restricted-record maintenance, request authorization, all-operator journal and session revocation |
| `auditor` | `Auditor-demo-42!` | Inquiry only; cannot modify member records or open accounts |

Five failed password attempts lock the operator for five minutes. Supervisor authorization requires password verification, applies to one specific saved request, and does not change the signed-in operator. An operator cannot approve their own request. For the restricted-member workflow, prepare the request as `teller`, then let a person enter the supervisor credentials in the authorization screen.

## What works

- Member-number search and paginated surname-prefix search, with explicit not-found results and row selection.
- Member profiles, a nested share-account register, balances, and posting history.
- Contact maintenance with format validation and optimistic concurrency checks.
- Append-only service notes with HTML escaping.
- New regular, holiday, and education savings accounts: data entry → saved review → optional supervisor authorization → explicit posting → persistent receipt.
- Opening funds transferred from an existing open account belonging to the same member. Amounts use integer cents, and the account, debit, credit, and receipt are committed in one SQLite transaction.
- Work-in-process queues, cancelled requests, journal entries, operator sessions, sign-off, and revocation.
- Server-enforced business outcomes for closed membership, duplicate share class, insufficient funds, stale member state, and restricted-member approval.

Preparing a request does not create an account or move funds. Posting rechecks live member and funding state. Reposting the same request returns its existing result without duplicating the transfer. Changing member contact details invalidates older unposted requests; cancel and prepare them again. A member may hold one account of each product class.

## Fixture directory

All member records, addresses, contact details, and funds are synthetic. Emails use `example.invalid`; telephone numbers use the fictional 555-01xx range.

| Search value | Initial condition |
| --- | --- |
| `12345` | Avery Reed; active, checking balance 2,450.75; no savings account |
| `12346` | Jordan Vale; restricted; new accounts require supervisor approval |
| `12347` | Robin Chen; closed membership |
| `12348` | Sam Reed; second result for a `Reed` surname inquiry |
| `12349` | Taylor Brooks; checking balance 2.50, below savings minimum |
| `12350` | Jamie Ortiz; already has regular savings |
| `99999` | No matching member |
| `Example` (surname) | 24 records across three pages |

Use **Member inquiry → search → select row → Process → Share maintenance** to prepare an account. Review is a valid stopping point. Posting is a separate explicit action that changes the local ledger. To inspect balances, use the nested Share register; choose an account and retrieve its history.

The [workflow and fixture contracts](docs/scenarios.md) specify exact inputs, review outputs, frame boundaries, business outcomes, and recovery expectations. They distinguish saving a review from posting an account.

## Controlled runtime faults

The **Workstation diagnostics** screen arms one fault for the current browser session:

| Diagnostic | Behavior |
| --- | --- |
| Slow inquiry | Delays the next member inquiry by three seconds |
| Host failure | The next inquiry returns a real HTTP 503; the next retry works |
| Host bulletin | An unexpected acknowledgment screen precedes the next inquiry |
| Access lease expiry | Requires browser session renewal, without entering the password again |
| Entire session expiry | Requires sign-on again; saved requests remain in Work in process |
| Lost posting response | Commits the next share opening, then returns HTTP 503; retrieve the request to reconcile the result |

Faults are explicit and consumed once, not randomly injected. Separate browser sessions are isolated. Business conditions such as insufficient funds and permission denial come from the actual records and operator roles.

## Authentication and boundaries

Authentication uses scrypt password hashes, opaque random access and refresh tokens, and a server-side session registry. Only token hashes are stored in SQLite. Access leases last five minutes; a session can be renewed within its eight-hour absolute lifetime and thirty-minute idle limit. Renewal is an explicit browser form, fitting the legacy workstation flow. Each successful renewal rotates both tokens. Reuse of a spent refresh token on renewal revokes that session family. Logout and operator revocation invalidate access and renewal together.

Cookies are HttpOnly and SameSite=Strict. They are intentionally not Secure on the default local HTTP listener. A separate signed cookie carries only a pre-authentication CSRF nonce; authenticated identity is stored server-side. Forms require CSRF tokens, cross-origin submissions are rejected, hosts are restricted to loopback names, pages are not cached, and the CSP permits framing only by the same origin. Refresh tokens and passwords never appear in browser JavaScript storage or the activity journal. The journal records event codes and references, not contact values or note bodies.

The implementation follows the [Flask security guidance](https://flask.palletsprojects.com/en/stable/web-security/) and the [OWASP session-management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), with refresh rotation informed by the [OWASP OAuth guidance](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html). This application does not implement OAuth or claim production banking certification.

This is a local training application with publicly documented operators and synthetic funds. It has no payment network, identity verification provider, password recovery, MFA, email delivery, or live bank integration. Credentials should be entered through the sign-on and authorization forms. Do not import real customer records.

## Development and checks

Portal regression tests are included in `tests/`. The standalone portal's GitHub workflow is not included in this source copy, and awl's existing CI does not automatically run these portal tests. Test execution is left to CI unless explicitly requested locally.

The suite covers authentication, CSRF, token rotation/reuse, expiry, role boundaries, fixture isolation, validation, ledger consistency, idempotence, stale requests, and scoped faults. Browser checks cover both input sets at the saved-review boundary, unchanged balances before posting, ambiguous row selection, business outcomes, bounded recovery, supervisor authorization, lost posting responses, and re-authentication. These are application checks, not evidence of an LLM discovery or replay run.

Follow the [distribution instructions](docs/distribution.md) to share the portal source independently. Including the source and tests is not a claim that the copied portal has passed CI.

The implementation is split into `portal/auth.py` (authentication and request guard), `portal/service.py` (transactional share operations), `portal/views.py` (HTML screen dispatch), `portal/db.py` and `portal/schema.sql` (persistence and fixtures), plus Jinja templates and static presentation files. `uv.lock` pins dependencies.

For a fresh training partition, **stop the server first**, then move the ignored `instance/` directory elsewhere and start again. This preserves the previous database as a backup and creates fresh fixtures. No reset route is exposed to the browser.
