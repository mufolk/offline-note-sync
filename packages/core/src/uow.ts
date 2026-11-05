import type { Accepted, Conflict, Content, Note, NoteNotFound } from "contracts";

/**
 * The three results a valid first arrival stores. REQ-14, RFC-001 §4.2.
 * `invalid` and `id_reused` are not here: neither writes a row.
 */
export type Receipt = Accepted | Conflict | NoteNotFound;

/** RFC-001 §4.2. The content is stored beside the result, not inside it. */
export type StoredReceipt = {
  readonly content: Content;
  readonly receipt: Receipt;
};

/**
 * One Step-3 row, as one write. ASM-28: the in-memory unit of work has no
 * rollback, so a note without its receipt must be unreachable. Making the pair
 * a single call is what makes it unreachable by construction instead of by the
 * discipline of not writing `await` between two `Map.set` calls.
 * `note` is absent on the rows that do not apply.
 */
export type Commit = {
  readonly op_id: string;
  readonly content: Content;
  readonly receipt: Receipt;
  readonly note?: Note;
};

/**
 * RFC-001 §4.3. The lock is a property of the unit of work, not of `process`.
 * Every method is async so one `process` serves the in-memory adapter today
 * and a Postgres one in the envelope (ASM-21).
 */
export type UnitOfWork = {
  /** Acquire the global writer lock, run fn, release. Releases on throw. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  findNote(note_id: string): Promise<Note | undefined>;
  findReceipt(op_id: string): Promise<StoredReceipt | undefined>;
  commit(write: Commit): Promise<void>;
};
