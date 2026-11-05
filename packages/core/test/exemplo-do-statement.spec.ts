import { beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryUnitOfWork,
  process,
  query,
  type UnitOfWork,
} from "../src/index.ts";

/**
 * The worked example, step by step, in order.
 * Each case is named after the line of the table it reproduces (EX-01..EX-08
 * in docs/reqs.md). One note N, two devices, one shared unit of work.
 */

const O1 = { op_id: "O1", note_id: "N", base_revision: 0, text: "início" };
const O2 = { op_id: "O2", note_id: "N", base_revision: 1, text: "edição A" };
const O3 = { op_id: "O3", note_id: "N", base_revision: 1, text: "edição B" };
const O4 = { op_id: "O4", note_id: "N", base_revision: 2, text: "A + B" };

describe("the worked example, step by step", () => {
  let uow: UnitOfWork;

  beforeEach(() => {
    // REQ-01. The server starts with no notes.
    uow = createInMemoryUnitOfWork();
  });

  it("EX-01 — O1, base 0, 'início': creates N at revision 1", async () => {
    expect(await process(O1, uow)).toEqual({
      type: "accepted",
      op_id: "O1",
      note_id: "N",
      text: "início",
      revision: 1,
    });
  });

  it("EX-02 — O2, base 1, 'edição A': updates N to revision 2", async () => {
    await process(O1, uow);

    expect(await process(O2, uow)).toEqual({
      type: "accepted",
      op_id: "O2",
      note_id: "N",
      text: "edição A",
      revision: 2,
    });
  });

  it("EX-03 — O3, base 1, 'edição B': conflict, N keeps 'edição A'", async () => {
    await process(O1, uow);
    await process(O2, uow);

    expect(await process(O3, uow)).toEqual({
      type: "conflict",
      op_id: "O3",
      note_id: "N",
      base_revision: 1,
      server_text: "edição A",
      server_revision: 2,
      client_text: "edição B",
    });

    // The conflict changed nothing. N still holds "edição A".
    expect(await query("N", uow)).toEqual({
      type: "found",
      note_id: "N",
      text: "edição A",
      revision: 2,
    });
  });

  it("EX-04 — resend of O2 repeats the revision 2 receipt, applying nothing", async () => {
    await process(O1, uow);
    const first = await process(O2, uow);
    await process(O3, uow);

    const resend = await process({ ...O2 }, uow);

    expect(resend).toEqual(first);
    // The revision did not move.
    expect(await query("N", uow)).toMatchObject({ revision: 2 });
  });

  it("EX-05 — O4, base 2, 'A + B': updates N to revision 3", async () => {
    await process(O1, uow);
    await process(O2, uow);
    await process(O3, uow);

    expect(await process(O4, uow)).toEqual({
      type: "accepted",
      op_id: "O4",
      note_id: "N",
      text: "A + B",
      revision: 3,
    });
  });

  it("EX-06 — resend of O3 still shows the original conflict, at revision 2", async () => {
    await process(O1, uow);
    await process(O2, uow);
    const original = await process(O3, uow);
    await process(O4, uow);

    // REQ-19. The note is at revision 3 by now; the receipt is not.
    expect(await process({ ...O3 }, uow)).toEqual(original);
    expect(await process({ ...O3 }, uow)).toMatchObject({
      server_revision: 2,
      server_text: "edição A",
    });
  });

  it("EX-07 — a query shows revision 3", async () => {
    await process(O1, uow);
    await process(O2, uow);
    await process(O3, uow);
    await process(O4, uow);

    expect(await query("N", uow)).toEqual({
      type: "found",
      note_id: "N",
      text: "A + B",
      revision: 3,
    });
  });

  it("EX-08 — reusing O2 with a different text is an error", async () => {
    await process(O1, uow);
    await process(O2, uow);

    expect(await process({ ...O2, text: "outro texto" }, uow)).toEqual({
      type: "id_reused",
      op_id: "O2",
    });
  });

  it("resolving O3's conflict from the frozen revision conflicts again", async () => {
    await process(O1, uow);
    await process(O2, uow);
    const conflict = await process(O3, uow);
    await process(O4, uow);

    // The receipt says 2; the note is at 3. Reusing the frozen revision is
    // another conflict — that is OCC, not a bug (RFC-001 §4.5).
    expect(conflict).toMatchObject({ server_revision: 2 });
    expect(
      await process(
        { op_id: "O5", note_id: "N", base_revision: 2, text: "escolhido" },
        uow,
      ),
    ).toMatchObject({ type: "conflict", server_revision: 3 });

    // REQ-21. A new op_id, the chosen text, and the current base revision.
    const live = await query("N", uow);
    expect(live).toMatchObject({ type: "found", revision: 3 });

    expect(
      await process(
        { op_id: "O6", note_id: "N", base_revision: 3, text: "escolhido" },
        uow,
      ),
    ).toEqual({
      type: "accepted",
      op_id: "O6",
      note_id: "N",
      text: "escolhido",
      revision: 4,
    });
  });
});
