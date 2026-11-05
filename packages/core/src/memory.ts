import type { Note } from "contracts";
import type { Commit, StoredReceipt, UnitOfWork } from "./uow.ts";

/**
 * RFC-001 §4.3. Hand-rolled mutex, no package: `packages/core` has zero
 * dependencies (ASM-23). One global writer lock, not per `op_id` and not per
 * `note_id` (ASM-22) — two ops on the same note both reading revision 1 is the
 * case a per-`op_id` lock misses.
 *
 * `run` is not reentrant: `run` inside `run` waits on a tail that can only
 * settle when the outer call finishes. The batch fold is a loop over
 * `process`, never `run(() => loop)` (ASM-27).
 *
 * Lookup is exact string equality — no trim, no case fold (RFC-001 §3).
 */
export function createInMemoryUnitOfWork(): UnitOfWork {
  const notes = new Map<string, Note>();
  const receipts = new Map<string, StoredReceipt>();
  let tail: Promise<unknown> = Promise.resolve();

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const done = tail.then(fn);
      // The empty catch keeps one rejected callback from killing the queue.
      // The caller of `run` still sees the error (ASM-29).
      tail = done.then(
        () => {},
        () => {},
      );
      return done;
    },

    async findNote(note_id: string): Promise<Note | undefined> {
      return notes.get(note_id);
    },

    async findReceipt(op_id: string): Promise<StoredReceipt | undefined> {
      return receipts.get(op_id);
    },

    async commit({ op_id, content, receipt, note }: Commit): Promise<void> {
      if (note !== undefined) notes.set(note.id, note);
      receipts.set(op_id, { content, receipt });
    },
  };
}
