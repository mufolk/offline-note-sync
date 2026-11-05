import { beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryUnitOfWork,
  process,
  query,
  type UnitOfWork,
} from "../src/index.ts";

describe("query (RFC-001 §4.5)", () => {
  let uow: UnitOfWork;
  beforeEach(() => {
    uow = createInMemoryUnitOfWork();
  });

  it("REQ-01 — the server starts with no notes", async () => {
    expect(await query("N", uow)).toEqual({ type: "absent", note_id: "N" });
  });

  it("REQ-20, REQ-22 — found shows the note as it is now, with its three fields", async () => {
    await process(
      { op_id: "A", note_id: "N", base_revision: 0, text: "agora" },
      uow,
    );

    const result = await query("N", uow);

    expect(result).toEqual({
      type: "found",
      note_id: "N",
      text: "agora",
      revision: 1,
    });
    expect(Object.keys(result).sort()).toEqual([
      "note_id",
      "revision",
      "text",
      "type",
    ]);
  });

  it("malformed is not invalid, and carries no op_id", async () => {
    for (const bad of ["", "   ", 7, null, undefined, {}, []]) {
      expect(await query(bad, uow)).toEqual({ type: "malformed" });
    }
  });

  /**
   * ASM-34. `absent` is live absence; `note_not_found` is a stored receipt of
   * a valid op. Creating the note later flips the query and leaves the
   * receipt alone.
   */
  it("ASM-34 — absent is not note_not_found, and the stale receipt stays stale", async () => {
    const receipt = await process(
      { op_id: "A", note_id: "N", base_revision: 4, text: "cedo demais" },
      uow,
    );
    expect(receipt).toMatchObject({ type: "note_not_found" });
    expect(await query("N", uow)).toEqual({ type: "absent", note_id: "N" });

    await process(
      { op_id: "B", note_id: "N", base_revision: 0, text: "enfim" },
      uow,
    );

    expect(await query("N", uow)).toMatchObject({ type: "found", revision: 1 });
    expect(
      await process(
        { op_id: "A", note_id: "N", base_revision: 4, text: "cedo demais" },
        uow,
      ),
    ).toEqual(receipt);
  });

  it("lookup is exact string equality — padding addresses a different note", async () => {
    await process(
      { op_id: "A", note_id: "  N  ", base_revision: 0, text: "t" },
      uow,
    );

    expect(await query("N", uow)).toEqual({ type: "absent", note_id: "N" });
    expect(await query("  N  ", uow)).toMatchObject({ type: "found" });
  });
});
