# ADR-005 — The core does not import a framework or a database; the envelope is an adapter

**Status:** Accepted as a boundary; the adapter is not built · **Date:** 2026-10-29 · **Review trigger revised:** 2026-10-30 · **Context:** RFC-001 §2, §8

## Context

The problem does not ask for disk or HTTP. The vacancy does. `process` and `query` take a `UnitOfWork` they do not own. The in-memory adapter is the only implementation. `packages/core/package.json` depends on `contracts`, the types package in this repo, and on nothing else. No Nest, Postgres, Zod, or model client is imported.

ADR-008 and ADR-009 are merged into this file, decided 2026-10-30. They are not filed, not proposed as intent, and not left as an open cut. There is no schema in the repo, so neither sentence is a decision about code that exists. A persisted constraint that can disagree with `check` is the review trigger below. The revision check leaving memory is wrong when two requests on the same note both pass the comparison and both write; the exit is one statement, `UPDATE … WHERE revision = $base`, in the same transaction as the receipt write. That statement is not in the tree. ASM-21, ASM-22, ASM-26 and ASM-28 point here.

## Decision

The core may not know a framework, a database, a validator, or a model client, and a reviewer checks that by opening `packages/core/package.json`, whose only dependency is `contracts`.

## Alternatives considered

**Write the rules inside a Nest service.** Buys one stack the vacancy recognizes, and one place for the revision check and the SQL. Costs a suite that needs a process, and a protocol that is hard to tell apart from the framework. Worth choosing for a four-hour submission graded on "did you use Nest".

**Build the Postgres adapter in this delivery and keep the core pure.** Buys the lock as code rather than as a sentence. Costs the hours the cut rule exists to protect. Worth choosing if the claim in the video is "this is how I would ship it" and the core is already green, which it is. The React screen is first in the RFC's cut order; Nest was meant to stay. Tonight the whole envelope was cut so the ADRs would exist.

## Consequences

Good. `pnpm test:core` is the whole problem: no Docker, no database, no API key. A later adapter implements the same four methods.

Bad. "No third-party dependencies" survives opening the file. "Zero runtime dependencies" does not, and neither does "zero entries under `dependencies`": `contracts` is one. There is no second copy of the types to drift, because there is no adapter. The in-memory lock is stronger than a Postgres read at READ COMMITTED would be (ASM-26), and the core suite cannot show that difference. Position in the batch is the only correlation key (ASM-45); that stops being true if results cross a boundary that does not preserve order.

## Review trigger

When a persisted constraint accepts an insert that `check` in `predicates.ts` would reject, this decision is wrong: the rule lives in two places and they disagree. The exit is one source. The predicate stays the rule, and the constraint is generated from the closed key set or it is not shipped. Migration is hours to regenerate on an empty store, and a backfill if a violating row has already landed. This delivery has no schema and no such insert, so the disagreement cannot be observed here.

The merged ADR-009 is a different fact. When two concurrent requests on the same note both pass the revision comparison and both write, a check separated from the write is wrong. The exit is one statement, `UPDATE … WHERE revision = $base`, in the same transaction as the receipt write. Migration is that statement, paid when an adapter exists. A Postgres `query` at READ COMMITTED is not either fact. The core suite cannot show that read, and no snapshot shape is chosen here.
