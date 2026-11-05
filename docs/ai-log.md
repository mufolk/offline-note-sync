# How the AI was used, and how that was checked

DEL-05. The plan asks for four to six entries, each in three lines: what was suggested, what was kept or changed, how it was checked. Six episodes are on record.

## 1. 2026-10-29, 01:32 — a base ahead of the server

The assistant framed a base ahead of the server as a choice between `invalid` and `conflict`, so that a broken client's text would be kept on purpose. I rejected that frame: the alternative written in RFC-001 §4.2 is a fifth result, and `client_text` is what every conflict stores, not a motive about a client judged broken. I checked that section, ASM-16, and the test `a base ahead of the server's revision is the same conflict`, which sends base 99 against revision 1 and expects `conflict`.

## 2. Two refusals to write the review triggers

Asked twice for the review-trigger text. The fields stayed blank on purpose. The sentences in the ADRs are the ones written by hand on 2026-10-29, on top of scaffolding that had been left empty. The check is each Review trigger: it opens with the fact that makes the decision wrong.

## 3. The red-team order, adopted and then reversed

The red-team order, adopted in that sitting, looked up a known `op_id` before the rest of the fields, so a stored id with a field missing came back `id_reused`. Reversed the same night: that order was the reviewer's, and a payload that fails the field check is not an operation, so it does not reuse an id and it does not replay a receipt. Checked against the rule that fields are checked before processing and that an invalid operation does not occupy `op_id`, against the order in RFC-001 §4 (predicates, then registry lookup), and against `process.spec.ts` → *REQ-13 — an invalid payload does not occupy the op_id*.

## 4. The Cursor and Claude trailers, kept

Co-author trailers were left on the commits that carried them. Stripping them was refused. This repository is one commit, so those trailers are not in this history. The check is `git log -1`: this commit does not carry them, and this entry is the record that they were kept where they belonged.

## 5. 2026-10-29 — the adversarial pass called every row met

The pass had the problem, the code, and the matrix, and returned twenty-two met with an empty "not verifiable" column. For REQ-10 it cited `text: op.text` with no concatenation; for REQ-11 it cited that no source file reads a clock. I did not keep that as proof. The README already called both rows absences, and a verdict that reads the implementation and calls the reading evidence is green and wrong. REQ-10 is now the test that fails if the texts are joined. REQ-11 stays declared: stubbing the clock on one path does not show it is never read.

## 6. 2026-10-30 — the review trigger has to say what makes the decision wrong

The dictated fields named a cost and an exit, then spent the rest of the paragraph on what this delivery cannot measure. ADR-008 and ADR-009 were "folded as seams," which is none of intent, merge, or cut. Rewritten so each Review trigger opens with the fact that makes the decision wrong, then the exit and what the migration costs. The accepted-proposal level was set in this pass: fewer proposals come back `accepted` than are refused. The lease, the tombstone, the ledger, and the generated constraint were already the exits. ADR-008 and ADR-009 are merged into ADR-005. Checked by reading each Review trigger. The reversal of the 24 October ledger sentence is the one ADR-002 records.
