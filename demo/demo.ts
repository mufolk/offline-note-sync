/**
 * The reproducible demonstration (DEL-02). RFC-001 §2: "a script that runs a
 * sequence and prints receipts."
 *
 * The scenario is deliberately not the worked example — that one is in
 * `test/exemplo-do-statement.spec.ts`. This is a different sequence, so it can
 * also serve as the video's scenario.
 *
 * Every step declares what it expects before it runs. The script compares the
 * declaration with what happened and exits non-zero on any mismatch, so the
 * demonstration verifies itself instead of asking the reader to eyeball it.
 *
 *   pnpm demo
 */
import type { ProcessResult, QueryResult } from "../packages/contracts/src/index.ts";
// Aliased: an unaliased `process` would shadow Node's global, and the
// non-zero exit at the bottom would silently set a property on a function.
import {
  createInMemoryUnitOfWork,
  process as processOperation,
  query,
} from "../packages/core/src/index.ts";

const uow = createInMemoryUnitOfWork();
const NOTE = "agenda";

let failures = 0;
let step = 0;

function show(value: unknown): string {
  return JSON.stringify(value);
}

function report(
  title: string,
  expectation: string,
  sent: unknown,
  got: ProcessResult | QueryResult,
  ok: boolean,
): void {
  step += 1;
  console.log(`\n${String(step).padStart(2, " ")}. ${title}`);
  console.log(`    sent     ${show(sent)}`);
  console.log(`    expect   ${expectation}`);
  console.log(`    got      ${show(got)}`);
  if (ok) {
    console.log("    ✓");
  } else {
    failures += 1;
    console.log("    ✗  MISMATCH");
  }
}

async function op(
  title: string,
  expectation: string,
  payload: unknown,
  holds: (r: ProcessResult) => boolean,
): Promise<ProcessResult> {
  const got = await processOperation(payload, uow);
  report(title, expectation, payload, got, holds(got));
  return got;
}

async function look(title: string, expectation: string, holds: (r: QueryResult) => boolean) {
  const got = await query(NOTE, uow);
  report(title, expectation, `query(${show(NOTE)})`, got, holds(got));
  return got;
}

const edit = (op_id: string, base_revision: number, text: string) => ({
  op_id,
  note_id: NOTE,
  base_revision,
  text,
});

console.log("Offline note sync. Two devices, one note: 'agenda'.");
console.log("Nothing on the server to begin with.");

// The phone was offline when someone mentioned the note. It edits a note that
// was never created. This is the statement's second branch, not a conflict.
await op(
  "phone edits a note that does not exist yet",
  "note_not_found — not a conflict: there is no server text to show",
  edit("p1", 3, "- roadmap"),
  (r) => r.type === "note_not_found",
);

await op(
  "laptop creates the note with base 0",
  "accepted, revision 1",
  edit("l1", 0, "1. budget"),
  (r) => r.type === "accepted" && r.revision === 1,
);

await op(
  "laptop adds a line",
  "accepted, revision 2",
  edit("l2", 1, "1. budget\n2. hiring"),
  (r) => r.type === "accepted" && r.revision === 2,
);

// The phone has been offline since revision 1 and does not know about l2.
const phoneConflict = await op(
  "phone, still at revision 1, sends its own second line",
  "conflict, holding BOTH texts — the server's and the phone's — unmerged",
  edit("p2", 1, "1. budget\n2. roadmap"),
  (r) =>
    r.type === "conflict" &&
    r.server_revision === 2 &&
    r.server_text === "1. budget\n2. hiring" &&
    r.client_text === "1. budget\n2. roadmap",
);

await op(
  "the phone's network blinked, so it sends p2 again",
  "the SAME conflict receipt, byte for byte, with no second attempt to apply",
  edit("p2", 1, "1. budget\n2. roadmap"),
  (r) => JSON.stringify(r) === JSON.stringify(phoneConflict),
);

await op(
  "meanwhile the laptop adds a third line",
  "accepted, revision 3",
  edit("l3", 2, "1. budget\n2. hiring\n3. offsite"),
  (r) => r.type === "accepted" && r.revision === 3,
);

// The rule most implementations get wrong: the stored receipt is never
// refreshed. A resend returns the original receipt, which may be stale (REQ-19).
await op(
  "the phone resends p2 once more, now that the note is at revision 3",
  "STILL the original conflict, frozen at revision 2 — a receipt is never refreshed",
  edit("p2", 1, "1. budget\n2. roadmap"),
  (r) => r.type === "conflict" && r.server_revision === 2,
);

await look(
  "a separate query, at the same moment",
  "found at revision 3 — the live read and the frozen receipt disagree, by design",
  (r) => r.type === "found" && r.revision === 3,
);

await op(
  "the phone reuses p2's op_id for different text",
  "id_reused — and nothing of the other client's text comes back with it",
  edit("p2", 1, "1. budget\n2. something else"),
  (r) => r.type === "id_reused" && Object.keys(r).length === 2,
);

await op(
  "the phone sends a malformed payload under a fresh id p3",
  "invalid, naming the failed fields — and carrying no op_id",
  { op_id: "p3", note_id: NOTE, base_revision: -1 },
  (r) => r.type === "invalid" && !("op_id" in r),
);

await op(
  "the phone fixes the payload and resends under the SAME id p3",
  "accepted at revision 4 — the invalid attempt never occupied the id",
  edit("p3", 3, "1. budget\n2. hiring\n3. offsite\n4. roadmap"),
  (r) => r.type === "accepted" && r.revision === 4,
);

await look(
  "final state",
  "found at revision 4, with the line the phone wanted, merged by a human",
  (r) => r.type === "found" && r.revision === 4,
);

console.log(
  `\n${step} steps, ${step - failures} as expected, ${failures} mismatched.`,
);

// Throwing, rather than setting an exit code, keeps this file free of Node
// globals and so of `@types/node`. A failing demonstration should be loud.
if (failures > 0) {
  throw new Error(
    `${failures} step(s) did not match the declared expectation.`,
  );
}
