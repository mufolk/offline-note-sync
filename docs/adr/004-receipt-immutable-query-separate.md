# ADR-004 — A receipt is immutable; query is a separate path

**Status:** Accepted in RFC-001 §4.5 and §5 · **Date:** 2026-10-29 · **Review trigger revised:** 2026-10-30 · **Context:** RFC-001 §4.5, §5

## Context

The problem says the result of a resend may contain stale data, because it is the receipt of the original operation, and that a separate query must show the note as it is now. The demo's steps 7 and 8 are that pair on purpose: the resent conflict's `server_revision` is still 2, and `query` at that moment returns 3.

## Decision

On a resend the server returns the stored receipt unchanged and refuses to refresh it; the helpful rewrite, or a resend answered with the live note, is the reflex this decision rejects, and the live note is only `query`, on its own result type.

## Alternatives considered

**Refresh the receipt when it is read.** Buys a client that can treat any response as current. Costs the sentence that separates the two, and makes "the original result" depend on when you asked. Worth choosing so a mobile client can have one endpoint.

**One result union for writes and reads.** Buys a single decoder. Costs `invalid` having to talk about an `op_id` a query does not have, and collapses `absent` into `note_not_found`. Those two are different: one is a live read, the other is a stored receipt that stays stored after the note is created (ASM-34). Worth choosing to keep the client's switch small.

## Consequences

Good. A given `op_id` is written once. `query` can move on without rewriting history. The worked example needs no special case.

Bad. A client that renders the receipt and never calls `query` shows stale text and looks fine. The next `base_revision` may be taken from that client's own `accepted` receipt (ASM-37), and that is safe only until another writer lands. A revision on a `conflict` receipt is never a safe base. Using it after the note has moved is another conflict, which is this decision holding, not a bug.

## Review trigger

When a client has no `query` and must learn the live note from a resend, this decision is wrong: the frozen receipt is then a stale answer, where today it is the rule the official pair demonstrates, the resent conflict still at revision 2 and `query` at 3. The exit is to return the live note beside the frozen receipt and leave the stored row alone. Rewriting the row on read would destroy the original result the resend exists to repeat. Migration is that extra read and a field on the response, and steps 7 and 8 of the official example stop being the contract. Nothing in this delivery counts callers that skip `query`.
