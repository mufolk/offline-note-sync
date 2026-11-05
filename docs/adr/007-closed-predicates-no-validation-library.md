# ADR-007 — The core checks a closed key set itself

**Status:** Accepted in `predicates.ts` · **Date:** 2026-10-29 · **Review trigger revised:** 2026-10-30 · **Context:** RFC-001 §4.1

The first draft of the plan (24 Oct) titles this ADR "Zod at the edge, types inferred". There is no Zod in the repo, and the types in `packages/contracts` are written by hand. The RFC's sentence is the one that matches the code: Zod `.strict()` would express the same rule at an HTTP edge, and the core implements it with no library. That edge was cut with the envelope.

Zod `.strict()` stays a legal later copy of the same rule, at that adapter, when the adapter exists. It is not a checker you can point at today.

## Context

Checking the fields does not say whether an unknown field is tolerated. The core rejects a payload that is not a plain object and rejects any enumerable own key outside `{op_id, note_id, base_revision, text}`. Emptiness is checked on the trimmed `op_id` and `note_id` only. `text` is a string, and `""` is legal (ASM-11). The value is stored as sent. A failure is `invalid`, names the predicates, and does not consult the registry.

## Decision

No validation library in the core, not a ban everywhere: the closed key set is checked by hand in `packages/core/src/predicates.ts`, and the plan's "edge" is the HTTP adapter this delivery cut, so nothing else in the tree checks that set.

## Alternatives considered

**Zod in the core, with the types inferred from the schema.** Buys one source for the shape and the check. Costs a library in the package this delivery keeps free of them, and a domain that imports a validator. Worth choosing so the edge and the core cannot drift once an edge exists.

**Ignore unknown keys.** Buys a newer client sending a field an older server does not know. Costs a payload that means two things to two readers, and a fingerprint that can ignore a field the client believed was part of the content. Worth choosing for a protocol expected to gain fields. The way out already named for the closed set is an explicit version and a new accepted key set (ASM-07).

## Consequences

Good. An unknown key does not occupy an `op_id`. The predicate names are a closed union. The suite does not install a validator.

Bad. The rule lives in `predicates.ts` only. A later Zod edge would be a second copy, which is the same drift ADR-005 already flags for a persisted receipt. There is no length cap in the core (ASM-15). `-0` passes `Number.isInteger` and then collapses under `===`.

## Review trigger

When one payload gets two answers, `check` accepting what a second checker rejects or the reverse, this decision is wrong: the hand-written predicate is no longer the single source. The exit is to generate the edge schema from the predicate, or to delete the overlapping hand-written branches. Migration is hours, on that first disagreement, before two clients depend on the two answers. A library that becomes the source crosses into the core, which this decision refuses. You do not get one source and a core free of the library. The instrument is the second checker; this delivery has only `predicates.ts`. A length cap at the edge is a different rule and is not this trigger.
