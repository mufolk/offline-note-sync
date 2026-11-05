# ADR-001 — Optimistic concurrency by revision, not last-write-wins

**Status:** Accepted in RFC-001 and in the core · **Date:** 2026-10-29 · **Review trigger revised:** 2026-10-30 · **Context:** RFC-001 §4.2, §6

## Context

Disconnected clients edit the same note and submit later, duplicated and out of order. The problem forbids joining the texts and forbids using the device clock to pick a winner. The server still has to accept, reject, or flag a conflict, and it must not drop work without a trace.

## Decision

The server accepts an operation on an existing note only when its `base_revision` equals that note's revision; otherwise it stores a `conflict`, leaves the note as it is, and lets the sender of a later operation choose the text.

## Alternatives considered

**Last-write-wins.** Buys the smallest server: keep the newest text and move on. Costs a silent loss, and the only definition of "newest" is a clock the problem forbids. Worth choosing for a single-user scratch pad where a lost edit is cheap and the protocol can be one field.

**CRDT.** Buys offline edits that merge with no round trip. Costs an automatic merge, which the problem forbids, and text nobody typed. Worth choosing if the product promise is "your edit always lands" rather than "your edit is never discarded without a receipt".

**Operational transformation.** Buys live co-editing with a defined transform. Costs the same automatic merge, plus a live channel the problem puts out of scope. Worth choosing for a document open on two screens at once.

## Consequences

Good. A conflict is a stored receipt holding both texts. The client resolves it with a new `op_id` and the live revision from `query`. Predicates, the receipt registry, and `query` do not depend on this choice.

Bad. The person who edited offline the longest is the one who resolves. On a busy note that resolution can starve: every resend arrives already stale (RFC-001 §7, risk 3). The core has no merge helper, so the friction is the whole interface.

## Review trigger

When one note's `conflict` results stay consecutive and the attempt ends without an `accepted`, this decision is wrong: resolving has become failing to save, and the person who edited longest is the one who cannot. The exit is a short edit lease, a record beside the note, held from the resolving read until the next operation, so other writers do not advance the revision while it is held. Migration is that record and that check, about a day in an adapter, once an adapter exists. A per-note queue that applied the stale text would be last-write-wins or a merge, both already refused. Assisted merge does not exit this failure: a stale proposal conflicts like any other operation, and that feature is ADR-010. The result codes stay. The note still has no clock field; the lease is not one. This delivery has no counter and no client identity, so a pile of conflict receipts is not yet that run. No attempt count is chosen. The fact is the run that does not end in `accepted`.
