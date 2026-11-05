import type { Content, Note, Operation, ProcessResult } from "contracts";
import { check } from "./predicates.ts";
import type { Commit, Receipt, UnitOfWork } from "./uow.ts";

/**
 * ASM-14. Content is `{note_id, base_revision, text}` with `===` on each
 * field; `op_id` is the key, not part of the fingerprint. `===` collapses
 * `-0` and `0`, which is the retry this rule exists for (ASM-13).
 */
function sameContent(a: Content, b: Content): boolean {
  return (
    a.note_id === b.note_id &&
    a.base_revision === b.base_revision &&
    a.text === b.text
  );
}

function contentOf(op: Operation): Content {
  return {
    note_id: op.note_id,
    base_revision: op.base_revision,
    text: op.text,
  };
}

/**
 * RFC-001 §4.2, the revision table. Runs only for a valid first arrival.
 * Total over the four rows: `current` exists only if the note exists — never
 * `note?.revision ?? 0`, which would turn a base 0 on a live note into a reset.
 */
function stepThree(
  op: Operation,
  note: Note | undefined,
): { readonly receipt: Receipt; readonly note?: Note } {
  if (note === undefined) {
    // Row 1: create at revision 1. REQ-03.
    if (op.base_revision === 0) {
      const created: Note = { id: op.note_id, text: op.text, revision: 1 };
      return {
        note: created,
        receipt: {
          type: "accepted",
          op_id: op.op_id,
          note_id: created.id,
          text: created.text,
          revision: created.revision,
        },
      };
    }
    // Row 2: the problem's second branch, the note does not exist yet.
    // REQ-09. No server_text and no server_revision: they do not
    // exist, and the absence is visible in the type (ASM-19, ASM-20).
    return {
      receipt: {
        type: "note_not_found",
        op_id: op.op_id,
        note_id: op.note_id,
        base_revision: op.base_revision,
        client_text: op.text,
      },
    };
  }

  // Row 3: replace the text and add 1, even if the text is identical. REQ-05,
  // REQ-06. Idempotency here is by `op_id`, never by content.
  if (op.base_revision === note.revision) {
    const applied: Note = {
      id: note.id,
      text: op.text,
      revision: note.revision + 1,
    };
    return {
      note: applied,
      receipt: {
        type: "accepted",
        op_id: op.op_id,
        note_id: applied.id,
        text: applied.text,
        revision: applied.revision,
      },
    };
  }

  // Row 4: base not the expected one. Covers base < revision and
  // base > revision, and base 0 on a live note. REQ-07, REQ-08. The server
  // text and the client proposal are both preserved, frozen at this moment.
  return {
    receipt: {
      type: "conflict",
      op_id: op.op_id,
      note_id: note.id,
      base_revision: op.base_revision,
      server_text: note.text,
      server_revision: note.revision,
      client_text: op.text,
    },
  };
}

/**
 * RFC-001 §4. Fixed order: predicates, registry lookup, revision table, write.
 *
 * The payload is `unknown` on purpose. Checking the fields is step 1, so an
 * invalid payload never reaches the registry and never occupies the `op_id`
 * (REQ-13).
 */
export async function process(
  payload: unknown,
  uow: UnitOfWork,
): Promise<ProcessResult> {
  // Step 1. Before the lock and before any I/O. The registry is not read.
  const checked = check(payload);
  if (!checked.ok) {
    return { type: "invalid", errors: checked.errors };
  }
  const op = checked.operation;
  const content = contentOf(op);

  return uow.run(async () => {
    // Step 2. Registry lookup. Neither branch writes.
    const existing = await uow.findReceipt(op.op_id);
    if (existing !== undefined) {
      // Return the original result and do not apply again (REQ-15). The stored
      // receipt may be stale; that is the rule, not a bug (REQ-19).
      if (sameContent(existing.content, op)) return existing.receipt;
      // Different content is `id_reused` (REQ-16).
      // The code and the key, nothing else: a colliding `op_id` must not leak
      // the other client's text (ASM-40, ADR-003).
      return { type: "id_reused", op_id: op.op_id };
    }

    // Step 3. Reads only.
    const step = stepThree(op, await uow.findNote(op.note_id));

    // Step 4. One write for the pair. Every Step-3 row writes a receipt,
    // including conflict (REQ-14). No `await` follows it (ASM-28).
    const write: Commit = {
      op_id: op.op_id,
      content,
      receipt: step.receipt,
      ...(step.note === undefined ? {} : { note: step.note }),
    };
    await uow.commit(write);
    return step.receipt;
  });
}

/**
 * RFC-001 §4.4. One result per operation, in the order received. An error or a
 * conflict does not block the rest (REQ-17, REQ-18).
 *
 * A conflict is a returned value, never a throw (ADR-006), so the loop
 * continues on its own. Operation k+1 sees the note and the registry after k,
 * which is why there is no snapshot at the start of the batch. The fold is a
 * loop over `process`, never `run(() => loop)`: `run` is not reentrant
 * (ASM-27).
 */
export async function processAll(
  payloads: readonly unknown[],
  uow: UnitOfWork,
): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];
  for (const payload of payloads) {
    results.push(await process(payload, uow));
  }
  return results;
}
