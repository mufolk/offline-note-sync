import { beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryUnitOfWork,
  process,
  query,
  type UnitOfWork,
} from "../src/index.ts";

const op = (over: Record<string, unknown> = {}) => ({
  op_id: "A",
  note_id: "N",
  base_revision: 0,
  text: "t",
  ...over,
});

describe("process — the revision table (RFC-001 §4.2)", () => {
  let uow: UnitOfWork;
  beforeEach(() => {
    uow = createInMemoryUnitOfWork();
  });

  it("REQ-03 — a missing note with base 0 is created at revision 1", async () => {
    expect(await process(op({ base_revision: 0 }), uow)).toEqual({
      type: "accepted",
      op_id: "A",
      note_id: "N",
      text: "t",
      revision: 1,
    });
  });

  it("REQ-05 — an accepted change replaces the text and adds 1", async () => {
    await process(op(), uow);

    expect(
      await process(op({ op_id: "B", base_revision: 1, text: "novo" }), uow),
    ).toMatchObject({ type: "accepted", text: "novo", revision: 2 });
  });

  it("REQ-06 — identical text still adds 1", async () => {
    await process(op({ text: "igual" }), uow);

    expect(
      await process(op({ op_id: "B", base_revision: 1, text: "igual" }), uow),
    ).toMatchObject({ type: "accepted", text: "igual", revision: 2 });
    expect(await query("N", uow)).toMatchObject({ revision: 2 });
  });

  /**
   * ASM-44's branch half. `note_not_found` and `conflict` are the confusable
   * pair — both are "the revision table says no" — with create sitting
   * between them. A `process` that returned a correctly spelled `conflict`
   * from the missing-note branch passes a spelling check and fails here.
   */
  it("ASM-44 — missing/base>=1, exists/base mismatch, and missing/base 0 are three different rows", async () => {
    const rows = [
      {
        note: "never-created",
        base: 1,
        type: "note_not_found",
      },
      { note: "live", base: 7, type: "conflict" },
      { note: "fresh", base: 0, type: "accepted" },
    ] as const;

    await process(op({ op_id: "seed", note_id: "live", base_revision: 0 }), uow);

    for (const row of rows) {
      const result = await process(
        op({ op_id: `k-${row.note}`, note_id: row.note, base_revision: row.base }),
        uow,
      );
      expect(result.type, `${row.note} @ base ${row.base}`).toBe(row.type);
    }
  });

  it("REQ-09 — note_not_found carries the client's text and no server fields", async () => {
    expect(
      await process(op({ note_id: "ghost", base_revision: 3 }), uow),
    ).toEqual({
      type: "note_not_found",
      op_id: "A",
      note_id: "ghost",
      base_revision: 3,
      client_text: "t",
    });
  });

  it("REQ-07, REQ-08 — conflict preserves the server text and the client proposal", async () => {
    await process(op({ text: "do servidor" }), uow);

    expect(
      await process(
        op({ op_id: "B", base_revision: 0, text: "do cliente" }),
        uow,
      ),
    ).toEqual({
      type: "conflict",
      op_id: "B",
      note_id: "N",
      base_revision: 0,
      server_text: "do servidor",
      server_revision: 1,
      client_text: "do cliente",
    });
  });

  it("REQ-10 — an accepted note's text is the operation's text, and a conflict returns each input unjoined", async () => {
    const sent = "edição A";
    const proposal = "edição B";

    const accepted = await process(op({ text: sent }), uow);
    expect(accepted.type).toBe("accepted");
    if (accepted.type === "accepted") expect(accepted.text === sent).toBe(true);

    const found = await query("N", uow);
    expect(found.type).toBe("found");
    if (found.type === "found") expect(found.text === sent).toBe(true);

    // REQ-10. A join is a third string.
    const conflict = await process(
      op({ op_id: "B", base_revision: 0, text: proposal }),
      uow,
    );
    expect(conflict.type).toBe("conflict");
    if (conflict.type === "conflict") {
      expect(conflict.server_text === sent).toBe(true);
      expect(conflict.client_text === proposal).toBe(true);
    }
  });

  it("base 0 on a live note is a conflict, not a reset", async () => {
    await process(op({ text: "vivo" }), uow);
    await process(op({ op_id: "B", base_revision: 1, text: "vivo 2" }), uow);

    expect(await process(op({ op_id: "C", base_revision: 0 }), uow)).toMatchObject(
      { type: "conflict", server_revision: 2 },
    );
    expect(await query("N", uow)).toMatchObject({ revision: 2, text: "vivo 2" });
  });

  it("a base ahead of the server's revision is the same conflict", async () => {
    await process(op(), uow);

    expect(await process(op({ op_id: "B", base_revision: 99 }), uow)).toMatchObject(
      { type: "conflict", base_revision: 99, server_revision: 1 },
    );
  });
});

describe("process — idempotency (RFC-001 §5)", () => {
  let uow: UnitOfWork;
  beforeEach(() => {
    uow = createInMemoryUnitOfWork();
  });

  it("REQ-14 — a conflict is stored and resending it returns the frozen pair", async () => {
    await process(op({ text: "servidor" }), uow);
    const conflict = await process(
      op({ op_id: "B", base_revision: 0, text: "cliente" }),
      uow,
    );
    // The note moves on after the conflict was recorded.
    await process(op({ op_id: "C", base_revision: 1, text: "depois" }), uow);

    expect(
      await process(op({ op_id: "B", base_revision: 0, text: "cliente" }), uow),
    ).toEqual(conflict);
  });

  it("REQ-15 — a resend does not apply the change a second time", async () => {
    await process(op(), uow);
    const first = await process(op({ op_id: "B", base_revision: 1 }), uow);

    expect(await process(op({ op_id: "B", base_revision: 1 }), uow)).toEqual(first);
    expect(await query("N", uow)).toMatchObject({ revision: 2 });
  });

  /**
   * ASM-39. Three calls that pin the stored row against a colliding op_id.
   * They are not independent: a mutation run on 2026-10-29 showed every wrong
   * store tried (overwrite on collision, file-beside-and-look-up-by-content,
   * fingerprint ignoring text, leaking the stored receipt) trips at least two
   * of them. The set is what holds; no single call is the witness for one bug.
   */
  describe("ASM-39 — a colliding op_id does not disturb the stored row", () => {
    const first = op({ op_id: "X", base_revision: 0, text: "original" });
    const colliding = op({ op_id: "X", base_revision: 0, text: "outro" });

    it("the colliding content returns id_reused", async () => {
      await process(first, uow);

      expect(await process(colliding, uow)).toEqual({
        type: "id_reused",
        op_id: "X",
      });
    });

    it("the same colliding content, sent again, is still id_reused", async () => {
      await process(first, uow);
      await process(colliding, uow);

      // A store that filed the colliding payload beside the first row and
      // looks it up by content answers this one with a receipt instead.
      expect(await process(colliding, uow)).toEqual({
        type: "id_reused",
        op_id: "X",
      });
    });

    it("the original content still returns the first receipt after a collision", async () => {
      const receipt = await process(first, uow);
      await process(colliding, uow);

      // A store that overwrote the fingerprint on collision answers this one
      // with id_reused instead of the original receipt.
      expect(await process({ ...first }, uow)).toEqual(receipt);
    });
  });

  /**
   * ASM-40. The type fixes the tag, not the key set: a wider value passes
   * everywhere excess property checking does not fire, which is everywhere
   * except a fresh literal. Returning the stored receipt through the widened
   * result type needs no cast and is the most natural line an implementer
   * writes — it is the ADR-003 leak arriving as ordinary idiomatic code.
   *
   * The matcher is load-bearing. `toMatchObject` and `objectContaining` pass
   * with the other client's text riding along; only `toEqual` fails on it.
   */
  it("ASM-40 — id_reused is exactly { type, op_id } and leaks no stored text", async () => {
    await process(op({ op_id: "X", text: "texto do outro cliente" }), uow);

    const result = await process(op({ op_id: "X", text: "meu texto" }), uow);

    expect(result).toEqual({ type: "id_reused", op_id: "X" });
    expect(Object.keys(result).sort()).toEqual(["op_id", "type"]);
  });

  it("REQ-13 — an invalid payload does not occupy the op_id", async () => {
    expect(await process({ op_id: "X", note_id: "N", text: "t" }, uow)).toMatchObject(
      { type: "invalid" },
    );

    // The same key still works afterwards: the registry was never written.
    expect(await process(op({ op_id: "X" }), uow)).toMatchObject({
      type: "accepted",
      op_id: "X",
    });
  });

  /**
   * ASM-41. `check` returns `{ ok: false, errors }`; that object is not
   * `Invalid`. This is the call where `process` wraps it, and the one that
   * shows no `op_id` rides along — the result must not read as a reservation.
   */
  it("ASM-41 — invalid is exactly { type, errors } with no op_id", async () => {
    const result = await process({ op_id: "X", note_id: 7, base_revision: -1 }, uow);

    expect(result).toEqual({
      type: "invalid",
      errors: ["note_id", "base_revision", "text"],
    });
    expect(Object.keys(result).sort()).toEqual(["errors", "type"]);
  });

  it("ASM-13 — -0 and 0 are the same content, in either order", async () => {
    const minusZero = op({ op_id: "Z", base_revision: -0 });
    const zero = op({ op_id: "Z", base_revision: 0 });

    const first = await process(minusZero, uow);
    expect(await process(zero, uow)).toEqual(first);

    const other = createInMemoryUnitOfWork();
    const firstOther = await process(zero, other);
    expect(await process(minusZero, other)).toEqual(firstOther);
  });

  it("ASM-13, ASM-14 — key order in the payload does not change the receipt", async () => {
    const first = await process(
      { op_id: "K", note_id: "N", base_revision: 0, text: "t" },
      uow,
    );

    expect(
      await process(
        { text: "t", base_revision: 0, note_id: "N", op_id: "K" },
        uow,
      ),
    ).toEqual(first);
  });
});

describe("process — the lock (RFC-001 §4.3)", () => {
  /**
   * ASM-25. Registry lookup, note write and receipt write are one locked
   * transaction. Without the lock both calls read revision 1 and one apply
   * vanishes — the lost update the statement exists to prevent.
   */
  it("ASM-25 — two overlapping ops on the same note give one accepted and one conflict", async () => {
    const uow = createInMemoryUnitOfWork();
    await process(op({ op_id: "seed" }), uow);

    const results = await Promise.all([
      process(op({ op_id: "A1", base_revision: 1, text: "a" }), uow),
      process(op({ op_id: "B1", base_revision: 1, text: "b" }), uow),
    ]);

    const types = results.map((r) => r.type).sort();
    expect(types).toEqual(["accepted", "conflict"]);
    expect(await query("N", uow)).toMatchObject({ revision: 2 });
  });
});
