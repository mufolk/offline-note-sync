import { array, assert, asyncProperty, constant, constantFrom, integer, oneof, record, string } from "fast-check";
import { expect, it } from "vitest";
import { createInMemoryUnitOfWork, process, query, type UnitOfWork } from "../src/index.ts";

/**
 * RFC-001 §4.3, three properties over a random sequence:
 * revision never decreases, a resend never changes a note, and the number of
 * accepted results for a note equals its revision.
 */

const notes = ["N", "M"] as const;

const validOp = record({
  op_id: string({ minLength: 1, maxLength: 6 }).filter((s) => s.trim().length >= 1),
  note_id: constantFrom(...notes),
  base_revision: integer({ min: 0, max: 5 }),
  text: string({ maxLength: 8 }),
});

const payload = oneof(
  { arbitrary: validOp, weight: 5 },
  { arbitrary: constant(null), weight: 1 },
  { arbitrary: constant("nope"), weight: 1 },
);

type Seen = { readonly revision: number; readonly text: string | undefined };

async function seen(uow: UnitOfWork): Promise<Record<(typeof notes)[number], Seen>> {
  const out = {} as Record<(typeof notes)[number], Seen>;
  for (const id of notes) {
    const result = await query(id, uow);
    out[id] =
      result.type === "found"
        ? { revision: result.revision, text: result.text }
        : { revision: 0, text: undefined };
  }
  return out;
}

it("a random sequence keeps revision monotonic, resends idle, and accepted counts equal revisions", async () => {
  await assert(
    asyncProperty(array(payload, { maxLength: 16 }), async (payloads) => {
      const uow = createInMemoryUnitOfWork();
      const accepted = new Map<string, number>(notes.map((id) => [id, 0]));
      const first: unknown[] = [];
      let before = await seen(uow);

      for (const item of payloads) {
        const result = await process(item, uow);
        const after = await seen(uow);
        for (const id of notes) {
          expect(after[id].revision).toBeGreaterThanOrEqual(before[id].revision);
        }
        if (result.type === "accepted") {
          accepted.set(result.note_id, (accepted.get(result.note_id) ?? 0) + 1);
        }
        first.push(result);
        before = after;
      }

      for (let i = 0; i < payloads.length; i++) {
        const prior = await seen(uow);
        expect(await process(payloads[i], uow)).toEqual(first[i]);
        expect(await seen(uow)).toEqual(prior);
      }

      for (const id of notes) {
        expect((await seen(uow))[id].revision).toBe(accepted.get(id));
      }
    }),
    { numRuns: 100 },
  );
});
