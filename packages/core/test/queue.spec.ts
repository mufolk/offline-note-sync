import { describe, expect, it } from "vitest";
import {
  createInMemoryUnitOfWork,
  process,
  processAll,
  query,
} from "../src/index.ts";

describe("processAll — the queue (RFC-001 §4.4)", () => {
  it("REQ-17, REQ-18 — a conflict in the middle does not block the rest", async () => {
    const uow = createInMemoryUnitOfWork();

    const results = await processAll(
      [
        { op_id: "O1", note_id: "N", base_revision: 0, text: "início" },
        { op_id: "O2", note_id: "N", base_revision: 1, text: "edição A" },
        { op_id: "O3", note_id: "N", base_revision: 1, text: "edição B" },
        { op_id: "O4", note_id: "N", base_revision: 2, text: "A + B" },
      ],
      uow,
    );

    expect(results.map((r) => r.type)).toEqual([
      "accepted",
      "accepted",
      "conflict",
      "accepted",
    ]);
    expect(await query("N", uow)).toMatchObject({ revision: 3, text: "A + B" });
  });

  it("REQ-18 — an invalid payload in the middle does not block the rest either", async () => {
    const uow = createInMemoryUnitOfWork();

    const results = await processAll(
      [
        { op_id: "O1", note_id: "N", base_revision: 0, text: "um" },
        null,
        { op_id: "O2", note_id: "N", base_revision: 1, text: "dois" },
      ],
      uow,
    );

    expect(results.map((r) => r.type)).toEqual([
      "accepted",
      "invalid",
      "accepted",
    ]);
  });

  it("one result per operation, in the order received", async () => {
    const uow = createInMemoryUnitOfWork();
    const ops = Array.from({ length: 5 }, (_, i) => ({
      op_id: `O${i}`,
      note_id: "N",
      base_revision: i,
      text: `t${i}`,
    }));

    const results = await processAll(ops, uow);

    expect(results).toHaveLength(ops.length);
    results.forEach((result, i) => {
      expect(result).toMatchObject({ type: "accepted", op_id: `O${i}` });
    });
  });

  it("an empty queue returns an empty array", async () => {
    expect(await processAll([], createInMemoryUnitOfWork())).toEqual([]);
  });

  /**
   * ASM-45. Index is the only correlation: `op_id` is payload, not an index.
   * `invalid` carries none, and one batch returns two results with the same
   * `op_id` when a later operation reuses an earlier one.
   */
  it("ASM-45 — index is the only correlation", async () => {
    const uow = createInMemoryUnitOfWork();

    const results = await processAll(
      [
        { op_id: "O1", note_id: "N", base_revision: 0, text: "um" },
        { op_id: "O1", note_id: "N", base_revision: 0, text: "outro" },
        "not an operation",
      ],
      uow,
    );

    expect(results.map((r) => r.type)).toEqual([
      "accepted",
      "id_reused",
      "invalid",
    ]);
    expect(results[0]).toMatchObject({ op_id: "O1" });
    expect(results[1]).toMatchObject({ op_id: "O1" });
    expect(results[2]).not.toHaveProperty("op_id");
  });

  /**
   * Snapshot-at-start of the batch is forbidden: operation k+1 sees the note
   * and the registry after k. A frozen snapshot turns this into three
   * note_not_found receipts.
   */
  it("operation k+1 sees the state after k", async () => {
    const uow = createInMemoryUnitOfWork();

    const results = await processAll(
      [
        { op_id: "A", note_id: "N", base_revision: 0, text: "1" },
        { op_id: "B", note_id: "N", base_revision: 1, text: "2" },
        { op_id: "C", note_id: "N", base_revision: 2, text: "3" },
      ],
      uow,
    );

    expect(results.map((r) => r.type)).toEqual([
      "accepted",
      "accepted",
      "accepted",
    ]);
  });

  it("the fold is not reentrant: processAll and a bare process share one lock", async () => {
    const uow = createInMemoryUnitOfWork();

    const [batch, single] = await Promise.all([
      processAll(
        [
          { op_id: "A", note_id: "N", base_revision: 0, text: "1" },
          { op_id: "B", note_id: "N", base_revision: 1, text: "2" },
        ],
        uow,
      ),
      process({ op_id: "C", note_id: "N", base_revision: 0, text: "x" }, uow),
    ]);

    expect(batch).toHaveLength(2);
    expect(single.type).toBeTypeOf("string");
    expect(await query("N", uow)).toMatchObject({ type: "found" });
  });
});
