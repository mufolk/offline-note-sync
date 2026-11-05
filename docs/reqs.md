# Requirements matrix — offline note sync

**Source:** `docs/problem.md`, read in Session 0 (27/10/2026).
**Method:** every obligation in that problem became one numbered REQ.
**Requirement column:** the rule as restated while reading.
**Proof column:** the test that proves it. Filled in during Session 2, as each test lands.

---

## System requirements (REQ)

| ID | Requirement | Proof |
|---|---|---|
| REQ-01 | No notes on the server at the start. | REQ-01 — the server starts with no notes |
| REQ-02 | Every client operation has `op_id`, `note_id`, `base_revision` and text. | accepts the official operation and stores each field as sent |
| REQ-03 | A note is created at revision 1 when the client sends base revision 0. | REQ-03 — a missing note with base 0 is created at revision 1 |
| REQ-04 | An existing note is only changed if the base revision equals the current revision number. | ASM-44 — missing/base>=1, exists/base mismatch, and missing/base 0 are three different rows |
| REQ-05 | If accepted, replace the text and add 1 to the revision number. | REQ-05 — an accepted change replaces the text and adds 1 |
| REQ-06 | If the text is identical, still add 1. | REQ-06 — identical text still adds 1 |
| REQ-07 | A conflict returns the server's current data. | REQ-07, REQ-08 — conflict preserves the server text and the client proposal |
| REQ-08 | Preserve the server's text and the client's proposal in the operation result. | REQ-07, REQ-08 — conflict preserves the server text and the client proposal |
| REQ-09 | An operation with base greater than zero for a non-existent note returns `note_not_found`. | REQ-09 — note_not_found carries the client's text and no server fields |
| REQ-10 | Do not merge texts automatically. | REQ-10 — an accepted note's text is the operation's text, and a conflict returns each input unjoined |
| REQ-11 | Do not use the device clock to pick a winner. | — absence, declared rather than tested. Stubbing `Date.now` to two absurd values and getting the same result shows the clock was not read on that path, not that it is never read. The note is exactly `{id, text, revision}` (ASM-04) and no result type carries a timestamp |
| REQ-12 | Before processing, check the operation's fields. | names each missing or illegal field, with extra_keys in front |
| REQ-13 | An invalid operation does not take up an `op_id`. | REQ-13 — an invalid payload does not occupy the op_id |
| REQ-14 | For every valid operation received for the first time, store its content and result, even if it was a conflict. | REQ-14 — a conflict is stored and resending it returns the frozen pair |
| REQ-15 | If the same `op_id` arrives again with the same content, return the original result without applying the change again. | REQ-15 — a resend does not apply the change a second time |
| REQ-16 | If the same `op_id` arrives with different content, return `id_reused`. | EX-08 — reusing O2 with a different text is an error |
| REQ-17 | Process the queue in the order received and return one result per operation. | one result per operation, in the order received |
| REQ-18 | An error or conflict does not block the following operations. | REQ-17, REQ-18 — a conflict in the middle does not block the rest |
| REQ-19 | The result of a resend may contain stale data: it is the receipt of the original operation. | EX-06 — resend of O3 still shows the original conflict, at revision 2 |
| REQ-20 | A separate query must show the note as it is now. | EX-07 — a query shows revision 3 |
| REQ-21 | To resolve a conflict, allow sending another operation with a new `op_id`, the chosen text and the current base revision. | EX-05 — O4, base 2, 'A + B': updates N to revision 3 |
| REQ-22 | Each note has an id, a text and a revision number. | REQ-20, REQ-22 — found shows the note as it is now, with its three fields |

---

## The worked example, as assertions (EX)

One sequence over note N. Each line is an executable assertion in `exemplo-do-statement.spec.ts`.

| ID | Step | Expected | Covers |
|---|---|---|---|
| EX-01 | O1: base 0, text "início" | creates N at revision 1 | REQ-03 |
| EX-02 | O2: base 1, text "edição A" | updates N to revision 2 | REQ-04, REQ-05 |
| EX-03 | O3: base 1, text "edição B" | conflict; N keeps "edição A" | REQ-07, REQ-08 |
| EX-04 | resend of O2, same content | repeats the success receipt for revision 2, applying no further change | REQ-15 |
| EX-05 | O4: base 2, text "A + B" | updates N to revision 3 | REQ-21 |
| EX-06 | resend of O3 | receipt still shows the original conflict, at revision 2 | REQ-14, REQ-19 |
| EX-07 | query the note | shows revision 3 | REQ-20 |
| EX-08 | reuse O2 with different text | error | REQ-16 |

EX-06 is the one to highlight: it is the line that forbids the "helpful" behaviour of refreshing a stored receipt.

---

## Non-goals

Not requirements — explicit permissions. The README and the ADRs can cite these instead of arguing.

- Client and server in a single process.
- No deletion, no automatic merge, no real-time editing, no disk storage, no HTTP.
- No coverage percentage target.
- No deployment, paid services, or hardware.

---

## Deliverables (DEL)

| ID | Deliverable | Where |
|---|---|---|
| DEL-01 | README with the focus and instructions to install, run and test. | `README.md` header and §1. |
| DEL-02 | Reproducible demonstration. | `demo/demo.ts`, run with `pnpm demo`. Self-verifying: each step declares its expectation and the script throws on any mismatch. |
| DEL-03 | Up to three highlighted tests, each with the expected result and the kind of bug it helps catch. | `README.md` §5 — the resent conflict, the reused `op_id`, and the invalid payload that does not burn its id. |
| DEL-04 | Two decisions taken during the work — what I wanted to check, how I investigated, what I concluded. One may be about an AI suggestion. | `README.md` §6 — validation before the registry, against the red-team suggestion; no operation ledger, against the first draft of the plan. |
| DEL-05 | How the AI was used and verified. | `docs/ai-log.md` — the ahead-base frame, the two review-trigger refusals, the red-team order, the co-author trailers, the adversarial pass that called every row met, the review-trigger rewrite. |
| DEL-06 | What was left pending. | `README.md` §8 — seven items. The envelope is not built: no Nest, no Postgres, no UI, no model adapter. |
| DEL-07 | Video, under 30 minutes, with a scenario different from the example, the expected result stated before running, one important test with the code it guards, and where the solution has limits. | |

Fictional data only. No credentials, no employer code.

---

## Open points

Three things left deliberately unresolved in Session 0. Two are now closed, each with the pointer that closes it. The third is a note, not a debt.

1. **Closed — REQ-09 names a code the problem does not.** The problem says only to indicate that the note does not exist yet. The identifier `note_not_found` is a naming decision. It is declared in the error taxonomy of RFC-001 §5 and numbered as **ASM-20** in `docs/assumptions.md`.
2. **Closed — the note entity has a REQ of its own.** Each note has an id, a text, and a revision number, so it is **REQ-22**. What the RFC adds on top — *exactly* those three fields, no timestamp, no author, hence no clock to resolve by — is a choice and lives as **ASM-04** in `docs/assumptions.md`.
3. **REQ-07 and REQ-09 come from one check.** They are two outcomes of the same comparison. Keeping them split is what forces two distinct tests.
