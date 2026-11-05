# RFC-001 — Sync protocol for offline notes

**Status:** Accepted · **Date:** 2026-10-28 · **Author:** Gui · **File:** `docs/rfc/001-protocolo-de-sincronizacao.md`

The problem is restated in `docs/problem.md` and numbered in `docs/reqs.md`. The body is the protocol accepted after the red-team pass of 2026-10-27/28. Own choices — rules the problem does not give — are marked as such. This RFC is the pointer column, not the source of the REQs.

---

## 1. Problem in one sentence

Disconnected clients edit the same note and send operations that arrive duplicated and late. The server must accept, reject, or flag a conflict without ever losing work silently.

---

## 2. Goals and non-goals

**Goal:** apply every rule of the problem in a pure, dependency-free core, tested in memory, behind two entry points: `process` and `query`.

| Non-goal | Authority |
|---|---|
| No automatic merge | REQ-10 |
| No clock-based resolution | REQ-11 |
| No deletion, no real-time editing | Out of scope. See `docs/problem.md`. |
| No disk, no HTTP in the core | Out of scope. The optional envelope (NestJS) is justified in ADR-005. |
| No authentication | Own choice. The problem never mentions identity. |

State lives in memory (`Map`). The official demonstration is a script that runs a sequence and prints receipts; a React screen is a bonus.

---

## 3. Data model

Three entities. The note has no timestamp and no author. The problem forbids a clock winner; the entity has no clock field to use.

- **Note:** `id`, `text`, `revision`. Starts with no notes on the server.
- **Operation** (client-generated `op_id`): `op_id`, `note_id`, `base_revision`, `text`.
- **Receipt:** the stored result of a valid first arrival, plus the content that produced it.

Source of truth = the current state of each note plus the receipts. There is no operation ledger. Receipts already store every valid operation with its content and result, so nothing disappears silently. The price: a note cannot be rebuilt from scratch (ADR-002).

Lookup of notes and receipts is **exact string equality**. No trim, no case fold. `"  A  "` and `"A"` are two notes. Own choice: we refused coercion; this is the cost.

---

## 4. Protocol as a state machine

Fixed order for `process`:

1. **Predicates** → `invalid` (nothing stored, registry not consulted).
2. **Registry lookup** (inside the unit of work) → same content: original receipt; different content: `id_reused` (does not write).
3. **Revision table** → `note_not_found` / `conflict` / apply.
4. **Write** the receipt every Step-3 row names; rows that apply also write the note. Same transaction.

An error or conflict never blocks the next operations in the queue: one result per operation, in the order received.

`query` is a second entry point. It is not an operation and does not use this machine.

### 4.1 Predicates

Authority: REQ-12, REQ-13, and REQ-02.

A payload that fails this check is not an operation. It has not arrived. The registry is not read. Nothing is stored. The result is `invalid`. That name belongs only to `process`. `query` uses the `note_id` rule below and returns `malformed` on `QueryResult`.

**Own choices**

- Closed key set, no unknown fields. One client; way out is an explicit version and a new accepted key set (ADR-007: Zod `.strict()` at the edge expresses this; the core implements the same rule with no library).
- No coercion, no trim of stored values. Validate emptiness on the trimmed string; store as sent.
- `op_id` / `note_id`: non-empty after trim. UUID is not required (the official table uses O1).
- `text: ""` is legal. The problem says text, not non-empty text, and increments on identical text.
- `base_revision` is a finite integer `>= 0`. "Revision number" is the only wording; this is the closed reading.
- Content of a valid op is `{note_id, base_revision, text}` with `===` on each field. `op_id` is the key, not the fingerprint.
- No length cap on `text`, `op_id`, or `note_id` in the core. The bound lives at the HTTP edge, where the body size is already limited.

**Shape.** The payload must be a plain object (`typeof === "object"`, not `null`, not an array, prototype `Object.prototype` or `null`). Anything else — string, `null`, array, `Date`, class instance — is `invalid`. An empty array has no extra enumerable keys; that is why this line exists.

Enumerable own keys are exactly `{op_id, note_id, base_revision, text}`. Any missing key, `null`, `undefined`, or extra enumerable own key → `invalid`.

| Field | Predicate | Store |
|---|---|---|
| `op_id` | `typeof === "string"` and `value.trim().length >= 1` | as sent |
| `note_id` | same | as sent |
| `base_revision` | `Number.isInteger(n) && n >= 0` | as sent |
| `text` | `typeof === "string"` (`""` allowed) | as sent |

`Number.isInteger` rejects every non-number, so strings, bigints, `null` and `undefined` fail before the range check. `-1` fails `>= 0`. `-0` passes (`Number.isInteger(-0)` and `-0 >= 0`); `===` treats it as `0` in the fingerprint.

Whitespace-only `op_id` or `note_id` (`"   "`) → `invalid`. `"  A  "` is valid; the stored key is `"  A  "`.

**Implementer** (no I/O, before any unit of work):

```
if not a plain object → invalid
if own enumerable keys ≠ {op_id, note_id, base_revision, text} → invalid
if any per-field predicate fails → invalid
else the payload is an operation; content = {note_id, base_revision, text}
```

### 4.2 Revision table (Step 3)

Runs only for a **valid first arrival**. Predicates have passed. The registry has no receipt for this `op_id`. Resend and `id_reused` never reach this table.

Authority: REQ-03 through REQ-09.

`current` exists only if the note exists. Do not write `note?.revision ?? 0`. After the predicates, `base_revision` is an integer `>= 0`.

| Note | `base_revision` | Result |
|---|---|---|
| missing | `=== 0` | apply: create at revision 1, text as sent |
| missing | `>= 1` | `note_not_found` |
| exists | `=== note.revision` | apply: replace text, revision + 1, even if the text is identical |
| exists | `!== note.revision` | `conflict` — includes base 0 on an existing note |

Every row of this table writes a receipt. Rows 1 and 3 also write the note. Rows 2 and 4 are not reads.

On apply (rows 1 and 3): the note is only `{id, text, revision}`. Nothing else changes. No timestamp, no author.

`note_not_found` is the problem's second branch, not a third outcome. The table only makes the choice total. Create is row 1 only. Base 0 on a live note is row 4, not a reset.

Row 4 covers `base < revision` (ordinary concurrent edit) and `base > revision` (a revision this server has never issued). Both are "base not the expected one". The problem draws no distinction. A fifth result is a protocol we were not given.

**Own choices**

- One `conflict` for both sides of row 4. Trigger: more than one server — then a base ahead of the local revision is worth logging as its own signal; it still returns `conflict` unless replication has started.
- Receipt field lists below (the problem names what to preserve, not the exact keys).

**Receipts** (valid first arrival; note mutation and receipt persist are one unit-of-work transaction):

- **accepted:** `op_id`, `type: "accepted"`, `note_id`, `text` as stored, `revision` after apply.
- **conflict:** `op_id`, `type: "conflict"`, `note_id`, `base_revision` sent, `server_text`, `server_revision` frozen at this moment, `client_text`. Both texts, as required. Two texts cannot share the key `text`; `text` stays on the note, on `accepted` and on query `found` (ASM-18).
- **note_not_found:** `op_id`, `type: "note_not_found"`, `note_id`, `base_revision` sent, `client_text`. No `server_text`, no `server_revision` — they do not exist, and the absence is visible in the type (ASM-19). This is not `conflict`. It is not query `absent`.

**Implementer**

```
if note missing && base === 0 → write note {id: note_id, text, revision: 1}; receipt accepted (revision 1)
if note missing && base >= 1 → receipt note_not_found
if note exists && base === note.revision → write note {…, text, revision: note.revision + 1}; receipt accepted
if note exists && base !== note.revision → receipt conflict (freeze today's server text and revision)
```

### 4.3 Unit of work and lock

`process` and `query` are the two entry points. Both take the unit of work. The lock is a property of the unit of work, not of `process`.

The problem does not name a lock, a transaction, or `async`. It names the facts this section has to keep true: one result per operation, in arrival order; a valid first arrival stores content and result, including `conflict`; a resend does not apply again; a separate query shows the note as it is now.

**Own choices**

- The core is `async`. Same `process(op, uow)` on an in-memory UoW today and a Postgres UoW in the envelope. A synchronous core would be a second machine the moment I/O appears.
- One global writer lock in the in-memory adapter. Per-`op_id` misses two different ops on the same note (both read revision 1, one apply vanishes). Per-`note_id` is the later split.
- Hand-rolled mutex, no package. `packages/core` has zero dependencies.
- Predicates run **before** any I/O and **before** the lock. They do not touch the registry.
- From registry lookup through note write and receipt write: one locked transaction.
- `query` takes the same global writer lock. Single process, one writer, no concurrent readers to starve, and the read is trivially consistent. The in-memory read is deliberately stronger than a Postgres `query` at READ COMMITTED: a plain `SELECT` takes no writer lock, readers and writers do not block each other, and the reader sees a snapshot. The core suite cannot produce the read that observes a note at revision N+1 before, or without, the matching receipt. That read is argued when a Postgres `query` exists. The ingredients sit with ADR-005, where ADR-008 and ADR-009 were merged on 2026-10-30.

**Triggers**

- The fact that kills the global lock: concurrent writers to **distinct** notes. p95 climbing while most notes are idle is how you notice. Then lock per `note_id`.
- A second process kills **both** locks. The way out is Postgres (one `BEGIN`/`COMMIT`, unique `op_id`, `UPDATE … WHERE revision = $base`), not a finer mutex.

**Interface**

```
uow.run(fn) → Promise<T>     // acquire global lock, run fn, release
process(op, uow) → Promise<ProcessResult>
query(note_id, uow) → Promise<QueryResult>
```

`run` releases on throw. `run` is not reentrant: `run` inside `run` waits on a `tail` that can only settle when the outer call finishes. The batch fold must be `for (op of ops) await process(op, uow)`, never `run(() => { for ... process ... })`.

Do not `await` after the first write because the in-memory UoW has no rollback: a throw between `notes.set` and `receipts.set` leaves a note without a receipt. The global lock already stops interleaving. Compute the receipt, then write; `Map.set` does not throw. Postgres gets the pair free with `ROLLBACK`.

**In-memory mutex**

```
let tail = Promise.resolve()

function run(fn) {
  const done = tail.then(fn)
  tail = done.then(() => {}, () => {})
  return done
}
```

The empty `catch` on `tail` keeps one thrown callback from killing the queue. The caller of `run` still sees the error. A conflict is a returned `ProcessResult`: `tail` does not reject, and this catch does not run. The batch continues because `process` returns that value (ADR-006).

**`process`, implementer**

```
if predicates fail → return invalid          // no lock, no I/O
return uow.run(() => {
  existing = receipts.get(op_id)             // exact string equality
  if existing && same content → return existing
  if existing && different content → return id_reused
  compute Step 3 against current notes       // reads only
  if that row writes a note → notes.set(...)
  receipts.set(op_id, { content, receipt }) // every Step-3 row
  return receipt
})
```

**Invariants** (property tests)

- For each note N: count of `accepted` receipts with `note_id === N` equals `N.revision`.
- `process` of a valid op already in the registry does not mutate notes.
- After `uow.run` returns, there is no note without its receipt and no receipt whose apply is missing.

### 4.4 Queue

Authority: REQ-17 and REQ-18.

```
processAll(ops, uow) → for (op of ops) await process(op, uow)
```

A conflict is a returned value. The loop continues, and the catch in §4.3 does not run. Same length, same index. Op *k+1* sees note and registry after *k*. Empty queue → `[]`. Snapshot-at-start of the batch is forbidden: it turns the official `[O1, O2, O3]` into frozen `note_not_found` receipts. Index is the only correlation. `op_id` is payload, not an index: `invalid` carries none, and one batch can return two results with the same `op_id` when a later operation reuses an earlier one (ASM-45).

**Rejected:** stamp every result with a server-assigned `index`. The result becomes self-describing, and it survives a transport that does not preserve array order. A slot number is not the client's `op_id`, so ASM-41 does not forbid it — the problem bars occupying the id, not identifying the slot. Rejected for this core: one in-memory call, no transport between the call and the caller, and the stamp can only ever equal the position it is written on. The type cannot carry the correlation either. `ProcessResult[]` returned for `Operation[]` has no length or order guarantee, and a mapped tuple over a tuple input is machinery out of proportion to the gain. The empty `errors` list is closed by the type. ASM-45 is closed only by the batch test. The packaging clause expires when results cross a boundary that does not guarantee order: a batch split across requests, a queue, or a client that merges responses. A JSON array on one HTTP call still preserves order. The stamp above is then the way out, and the change is a field. ASM-45 points at ADR-005. The review trigger that shipped is the duplicated predicate and constraint.

### 4.5 Query

A second entry point. Not an operation. No `op_id`, no content, no receipt.

Authority: REQ-20, REQ-19, and REQ-21.

`query` is the live read. A resend is the frozen write. Those are different verbs.

```
QueryResult =
  | { type: "malformed" }
  | { type: "absent", note_id }
  | { type: "found", note_id, text, revision }
```

| Result | Meaning |
|---|---|
| `malformed` | `note_id` failed the same predicate as an op (plain string, non-empty after trim). No lock. The caller fixes the argument and calls `query` again. Not `invalid`. No `op_id` to resend. |
| `absent` | No note with that id **now**. Not `note_not_found`. That name is a stored receipt of a valid op. A later create makes the next `query` return `found`; the old receipt stays `note_not_found`. |
| `found` | The note as it is now. `note_id` echoes the argument, which is `note.id`. No separate `id`. |

Lookup is exact string equality. `query("A")` after a create with `"  A  "` returns `absent`.

**Own choices**

- A distinct result type. Putting a read in the operation table would make `invalid` talk about `op_id` it does not have.
- No list of notes. No `query(op_id)`. The problem asks for one note, as it is now. Replay of a receipt is a resend of that valid op.
- `query` takes `uow.run`, the same lock as `process`. The reason and its limit are in §4.3.
- **Allowance, not a requirement:** a client may send the next op with `base_revision` equal to the revision on its own `accepted` receipt. That is how the official table runs. The live base is always `query`. The moment another writer may have landed, `query` is current. An `accepted` revision is only known to be current for the client that just wrote, and only until someone else writes. A `conflict` receipt is not in this allowance — its revision is frozen.

**Resolution is not a verb.** After `conflict`:

1. Keep the frozen pair of texts from that receipt (or resend the same valid op to get it back).
2. `query(note_id)` → live text and live revision.
3. New `op_id`, chosen text, `base_revision =` that revision.

Using the frozen revision after the official O4 (receipt says 2, `query` says 3) is another `conflict`. That is OCC, not a bug.

**Implementer**

```
if note_id is not a string with trim().length >= 1 → return { type: "malformed" }
return uow.run(() => {
  note = notes.get(note_id)
  if !note → return { type: "absent", note_id }
  return { type: "found", note_id, text: note.text, revision: note.revision }
})
```

No other fields on `found`. No timestamp. No receipts.

---

## 5. Taxonomy of operation results

This table is only `process`. `query` returns `QueryResult` and does not appear here.

Authority: REQ-13, REQ-14, REQ-15, and REQ-16.

A payload is an operation only after the predicates. A second arrival means a **valid** second arrival.

| Result | Meaning | Writes a receipt? | What a later **valid** payload with this `op_id` does |
|---|---|---|---|
| `invalid` | does not occupy `op_id` | no | This result does not speak about the registry. If no receipt exists, the next valid payload occupies. If one exists, that payload is a resend or `id_reused`. |
| `id_reused` | the id was reused | no — a receipt already exists for this id | This message is discarded. The stored receipt is unchanged. |
| `accepted` | — | yes | Same content → that receipt, no apply. Different content → `id_reused`. |
| `conflict` | the base revision did not match | yes | Same. Frozen pair stays frozen. |
| `note_not_found` | the note does not exist yet | yes | Same. Stale if the note is later created. |

There is no column “`invalid` ⇒ id reusable”. Reusability is a property of the registry, not of this message.

**Own choices**

- `accepted` is our name. The problem describes the write, not the token.
- `id_reused` is not stored. The first receipt remains the only row for that `op_id`.
- `id_reused` returns `{ type: "id_reused", op_id }` only. It does not return the stored receipt or the other payload. A colliding `op_id` must not leak another client’s text.
- `invalid` returns `{ type: "invalid", errors }` where `errors` names the failed predicates (e.g. `"not_plain_object"`, `"extra_keys"`, `"op_id"`, `"base_revision"`). Names only, never values. No `op_id` on this result — the result must not look like a reservation.

**Implementer**, after the predicates:

```
if not an operation → return invalid; stop
existing = receipts.get(op_id)
if existing && same content → return existing receipt; do not apply
if existing && different content → return id_reused; do not write
if no existing → Step 3; write the receipt that row names
```

A stored receipt never changes. A resend may be stale. `query` is now.

---

## 6. Rejected alternatives

- **Last-write-wins.** Simplest, but loses work silently and depends on the device clock. Block 3 forbids both.
- **CRDT.** Strong offline, but merges automatically (Block 3) and can produce text nobody wrote.
- **Operational transformation.** Merges automatically and is built for live editing, out of scope (Block 6).
- **Chosen:** optimistic concurrency control (ADR-001). Cost of reversing: switching to CRDT replaces only Step 3 and apply; predicates, taxonomy, and idempotency survive.

---

## 7. Risks and open questions

1. **Receipts grow forever.** We do not know how long they must be kept. Delete one before a client resends, and that operation is applied twice.
2. **`op_id` collisions.** Two devices picking the same `op_id` get `id_reused` or, on a first-arrival race the lock missed, a false receipt. Assumption: `op_id`s are practically unique. Predicates do not enforce UUID format (the official example uses O1).
3. **Starvation on busy notes.** Someone resolving a conflict can keep losing the race, because every new op is already stale on arrival.
4. **Plausible but wrong LLM merges.** The model can drop or invent a sentence and a hurried user accepts it. Mitigation: never auto-accept; the proposal is an ordinary op (ADR-010).
5. **Whitespace identities.** Exact-match lookup plus “store as sent” means inconsistent padding addresses different notes. Declared in §3 and §4.5. The first two-line test that looks like a bug is this; it is not a bug.

Closed by this revision (were open in the proposal): Step 3 was not total; `invalid` claimed the `op_id` was reusable; the receipt was written after apply as a separate step; `query` was missing; predicates were a placeholder.

---

## 8. Execution plan

Seven sessions: 0 requirements matrix · 1 this RFC · 2 pure core · 3 envelope (NestJS + React screen) · 4 ADRs, README, LLM adapter · 5 adversarial verification · 6 video.

Session 0 is closed: `docs/reqs.md` carries 22 numbered REQs, and every one of them was walked against a section of this file on 2026-10-28 — none was left without a home. The choices this file makes that the problem does not give are numbered separately in `docs/assumptions.md`.

Cut order if time runs short: the React screen goes first, NestJS stays. The core, the ADRs and the README are never cut.

Cut executed 2026-10-29: the whole envelope went, including NestJS, so the ADRs would exist. Session 3 did not happen. The sentence above is the rule as accepted; the cut broke it on purpose. ADR-005 is the record. A draft that had Nest and Postgres built is superseded by that cut, not by this section.

---

## Official example (normative check)

Two devices, note N. After this RFC, the sequence must hold without a special case.

| Op | Sent | Result |
|---|---|---|
| O1 | base 0, “início” | accepted, N revision 1 |
| O2 | base 1, “edição A” | accepted, N revision 2 |
| O3 | base 1, “edição B” | `conflict`; N keeps “edição A”; receipt freezes revision 2 and both texts |
| Resend O2 | same content | original accepted receipt for revision 2; no second apply |
| O4 | base 2, “A + B” | accepted, N revision 3 |
| Resend O3 | same content | original `conflict` at revision 2 |
| `query(N)` | — | `found`, revision 3, text “A + B” |
| O2 with other text | — | `id_reused` |

O3’s client resolving from the frozen revision 2 after O4 gets another `conflict`. They `query`, then send a new `op_id` with base 3.
