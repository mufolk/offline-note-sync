# Offline note sync

**Focus:** back end and architecture.

The problem this core solves is [`docs/problem.md`](docs/problem.md). The in-memory
core, the demonstration, and the documents in this repository are the whole delivery.
§8 is what was not built.

---

## 1. Run it

Requires **Node 22.6 or newer** (the demo runs TypeScript directly, with no build
step) and pnpm.

```bash
pnpm i
pnpm test:core   # 56 tests, 7 files
pnpm demo        # the reproducible demonstration, below
```

Nothing else is needed — no Docker, no database, no API key. `packages/core` has no
third-party dependencies, which is why the suite runs in under a second. That boundary is a
decision, not an accident; ADR-005 argues it.

Typechecks: `pnpm check:contracts`, `pnpm check:core`, `pnpm check:demo`.

## 2. The reproducible demonstration

`pnpm demo` runs a scenario that is **not** the worked example (that one is an
executable spec — see §4). Two devices edit one note, `agenda`, while one of them is
offline.

Every step prints what it **expects** before it prints what happened, and the script
exits non-zero if any step disagrees. So the demonstration verifies itself rather than
asking you to read twelve JSON blobs and take its word for it.

The three steps worth watching:

- **step 7** — the phone resends an operation that conflicted. The note has moved on to
  revision 3 by then; `server_revision` on the receipt is still 2. `base_revision` on
  that receipt is 1, the base the phone sent. A stored receipt is never refreshed.
- **step 8** — a `query` at that same moment returns revision 3. The frozen receipt and
  the live read disagree, by design.
- **steps 10 and 11** — a malformed payload under a fresh `op_id`, then the same `op_id`
  with the payload fixed. The second one is accepted: an invalid operation never
  occupied the id.

## 3. How it is laid out

```
packages/contracts   types only — the protocol's shapes, no logic
packages/core        the rules: predicates, process, processAll, query
demo/                the runnable demonstration (not part of the core)
docs/problem.md      the problem, in one page
docs/rfc/001-…       the protocol, written before the first line of code
docs/reqs.md         every obligation, numbered, with the test that proves it
docs/assumptions.md  every rule the solution obeys that the problem does not decide
```

The core is `process(payload, uow)` and `query(note_id, uow)`, over a `UnitOfWork` it
does not own. The in-memory unit of work lives beside it; a Postgres one would implement
the same four methods.

An operation always walks the same four steps, and the order is the part that is
easiest to get wrong: **predicates → registry lookup → revision table → write**. Validating
after the idempotency lookup would let a malformed payload burn an `op_id` forever.

## 4. Requirements matrix

Every obligation is numbered in `docs/reqs.md`. This table is that file's REQ ↔ test
mapping. One row is an absence rather than behaviour, and says why it is declared
instead of tested.

| ID | Requirement | Proof |
|---|---|---|
| REQ-01 | No notes on the server at the start. | `query` → the server starts with no notes |
| REQ-02 | Every client operation has `op_id`, `note_id`, `base_revision` and text. | `predicates` → accepts the official operation and stores each field as sent |
| REQ-03 | A note is created at revision 1 when the client sends base revision 0. | `process` → a missing note with base 0 is created at revision 1 |
| REQ-04 | An existing note is only changed if the base revision equals the current revision number. | `process` → missing/base>=1, exists/base mismatch, and missing/base 0 are three different rows |
| REQ-05 | If accepted, replace the text and add 1 to the revision number. | `process` → an accepted change replaces the text and adds 1 |
| REQ-06 | If the text is identical, still add 1. | `process` → identical text still adds 1 |
| REQ-07 | A conflict returns the server's current data. | `process` → conflict preserves the server text and the client proposal |
| REQ-08 | Preserve the server's text and the client's proposal in the operation result. | `process` → conflict preserves the server text and the client proposal |
| REQ-09 | An operation with base greater than zero for a non-existent note returns `note_not_found`. | `process` → note_not_found carries the client's text and no server fields |
| REQ-10 | Do not merge texts automatically. | `process` → an accepted note's text is the operation's text, and a conflict returns each input unjoined |
| REQ-11 | Do not use the device clock to pick a winner. | *absence, declared rather than tested* — stubbing the clock and seeing the same result shows it was not read on that path, not that it is never read. The note is `{id, text, revision}` (ASM-04), and no result carries a timestamp |
| REQ-12 | Before processing, check the operation's fields. | `predicates` → names each missing or illegal field, with extra_keys in front |
| REQ-13 | An invalid operation does not take up an `op_id`. | `process` → an invalid payload does not occupy the op_id |
| REQ-14 | For every valid operation received for the first time, store its content and result, even if it was a conflict. | `process` → a conflict is stored and resending it returns the frozen pair |
| REQ-15 | If the same `op_id` arrives again with the same content, return the original result without applying the change again. | `process` → a resend does not apply the change a second time |
| REQ-16 | If the same `op_id` arrives with different content, return `id_reused`. | `exemplo-do-statement` → reusing O2 with a different text is an error |
| REQ-17 | Process the queue in the order received and return one result per operation. | `queue` → one result per operation, in the order received |
| REQ-18 | An error or conflict does not block the following operations. | `queue` → a conflict in the middle does not block the rest |
| REQ-19 | The result of a resend may contain stale data: it is the receipt of the original operation. | `exemplo-do-statement` → resend of O3 still shows the original conflict, at revision 2 |
| REQ-20 | A separate query must show the note as it is now. | `exemplo-do-statement` → a query shows revision 3 |
| REQ-21 | To resolve a conflict, allow sending another operation with a new `op_id`, the chosen text and the current base revision. | `exemplo-do-statement` → EX-05 — O4, base 2, 'A + B': updates N to revision 3 |
| REQ-22 | Each note has an id, a text and a revision number. | `query` → found shows the note as it is now, with its three fields |

The worked example runs as its own spec, step by step:
`packages/core/test/exemplo-do-statement.spec.ts`.

## 5. Three tests worth your time

Each of these catches a whole class of bug rather than one case.

**1 — A resent conflict returns the original conflict, with the revision of that moment.**
`process.spec.ts` → *REQ-14 — a conflict is stored and resending it returns the frozen pair*,
and `exemplo-do-statement.spec.ts` → *EX-06*.
Catches the single most tempting bug: "helpfully" refreshing a stored receipt with the
current server state. REQ-19 forbids it. A resend returns the original receipt, which
may be stale. REQ-14 is the test that names that bug. EX-06 and ASM-34 catch it too.

**2 — The same `op_id` with different text returns `id_reused`, and nothing else.**
`process.spec.ts` → *ASM-40 — id_reused is exactly { type, op_id } and leaks no stored text*.
Catches two things. First, an idempotency registry that stores only the key and not a
fingerprint of the content: it cannot tell a retry from a reused key, so it returns the
original receipt where it should refuse. Second, the courteous version that returns the
stored receipt alongside the refusal — which turns a guessed `op_id` into an oracle over
another client's text. The assertion is `toEqual` plus an explicit key list, because
`toMatchObject` passes happily with the leak attached.

**3 — A malformed operation does not burn its `op_id`.**
`process.spec.ts` → *REQ-13 — an invalid payload does not occupy the op_id*.
Catches an inverted order between validation and the idempotency registry. If the
registry is consulted first, a typo'd payload reserves that `op_id` for all time and the
client's retry — now correct — comes back `id_reused`. The test sends a bad payload,
then the same key with a good one, and expects `accepted`.

## 6. Two decisions I made along the way

**A malformed payload is not a reuse of the id.** The red-team pass on RFC-001 pressed
the other answer: an `op_id` the server has already stored, arriving again with a field
missing, should come back `id_reused`. I adopted that order, then reversed it the same
night, because a payload that fails the check is not an operation, so it cannot reuse an
id and it cannot replay a receipt. The problem says to check the fields before
processing, and that an invalid operation does not occupy `op_id`. The
test is `process.spec.ts` → *REQ-13 — an invalid payload does not occupy the op_id*: the
bad payload, then the same `op_id` with the payload fixed, and the second result is
`accepted`.

**There is no operation ledger.** The first draft of the plan (24 Oct) said the ledger is the truth and the
note is a fold of it. I wanted to check whether the problem asked for that. It asks to
store the content and the result of every valid first arrival. It never asks for the note
at an earlier revision, or for the order of applies. `query` reads the current note,
`{id, text, revision}`, and does not read the receipt registry. Accepted texts are still
sitting on those receipts, keyed by `op_id`; the server will not rebuild the note from
them. That is ADR-002. Putting the ledger in later is a new store, not a backfill of a
history that was never written.

How those checks were made, and the other times a suggestion was kept or dropped, is `docs/ai-log.md`.

## 7. Architecture decisions

Eight are filed under `docs/adr/`. ADR-008 and ADR-009 are not filed: on 2026-10-30
they were merged into ADR-005. Not proposed as intent, and not left as an open cut.
**Decision** and **Review trigger** are filled in every file. Each review trigger
opens with the fact that makes that decision wrong, and names the exit.

| ADR | What it records |
|---|---|
| [001](docs/adr/001-optimistic-concurrency-by-revision.md) | Optimistic concurrency by revision, not last-write-wins. |
| [002](docs/adr/002-note-and-receipts-are-the-truth.md) | The current note plus the receipts are the truth. There is no operation ledger. The first draft of the plan (24 Oct) said the opposite; RFC-001 §3 is the decision that shipped. |
| [003](docs/adr/003-idempotency-by-receipt-and-fingerprint.md) | Idempotency by stored receipt plus a fingerprint of the content. |
| [004](docs/adr/004-receipt-immutable-query-separate.md) | A receipt is immutable. `query` is a separate path. |
| [005](docs/adr/005-core-without-framework-dependencies.md) | The core imports no framework and no database. The envelope is an adapter, and it is not built. |
| [006](docs/adr/006-errors-are-values.md) | Domain failures are values, not exceptions. |
| [007](docs/adr/007-closed-predicates-no-validation-library.md) | The core checks a closed key set itself. The plan's "Zod at the edge" title does not match the repo. |
| [010](docs/adr/010-model-proposes-an-operation.md) | A model may propose an operation. It does not write the note. Not built. |

## 8. What I did not do, and why

- **No HTTP API, no database, no UI.** The problem does not ask for them. A NestJS +
  Postgres envelope is planned and not built; the seam it would attach to is the
  `UnitOfWork` type, which is why that type exists at all.
- **No real parallelism.** One global writer lock, one process. Two servers break it, and
  the way out is Postgres (`UPDATE … WHERE revision = $base`), not a finer mutex.
- **No automatic retry.** A client that gets `conflict` decides what to do; the protocol
  will not pick for it, because picking is merging.
- **No authentication.** Never mentioned in the problem. It is the first thing a real
  deployment would need.
- **No deletion.** Explicitly out of scope.
- **Receipts are never compacted.** They grow forever. Dropping one before its client
  resends applies that operation twice — risk 1 of RFC-001 §7. That double apply is
  what makes unbounded retention wrong. The exit is a tombstone that keeps the
  `op_id` and returns a bare expired result (ADR-003). No window length is chosen.
- **No LLM adapter.** Planned as ADR-010: the model would propose a merged text as an
  ordinary operation, with a new `op_id` and the current base revision, so it has no
  authority over state by construction. Not built.

## 9. Video

The recording is still to be made, so this commit carries no URL. It has to stay under 30 minutes. `pnpm demo` is a scenario separate from the worked example.
