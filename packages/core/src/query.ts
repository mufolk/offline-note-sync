import type { QueryResult } from "contracts";
import type { UnitOfWork } from "./uow.ts";

/**
 * RFC-001 §4.5. A separate query shows the note as it is now
 * (REQ-20). A second entry point, not an operation: no `op_id`, no content,
 * no receipt.
 *
 * `query` is the live read; a resend is the frozen write. Different verbs.
 *
 * `malformed` is not `invalid`: there is no `op_id` to resend and nothing was
 * consulted (ASM-33). `absent` is not `note_not_found`: that name is a stored
 * receipt of a valid op, and it stays `note_not_found` even after the note is
 * created (ASM-34).
 */
export async function query(
  note_id: unknown,
  uow: UnitOfWork,
): Promise<QueryResult> {
  if (typeof note_id !== "string" || note_id.trim().length < 1) {
    return { type: "malformed" };
  }

  return uow.run(async () => {
    // Exact string equality, as everywhere else (RFC-001 §3).
    const note = await uow.findNote(note_id);
    if (note === undefined) return { type: "absent", note_id };
    return {
      type: "found",
      note_id,
      text: note.text,
      revision: note.revision,
    };
  });
}
