import { describe, expect, it } from "vitest";
import { createInMemoryUnitOfWork } from "../src/index.ts";

describe("run (RFC-001 §4.3)", () => {
  it(
    "ASM-27 — run inside run does not settle",
    async () => {
      const uow = createInMemoryUnitOfWork();
      let nested: Promise<string> | undefined;

      const outer = uow.run(async () => {
        nested = uow.run(async () => "inner");
        await new Promise((resolve) => setTimeout(resolve, 0));
        return Promise.race([
          nested.then(() => "settled" as const),
          new Promise<"timer">((resolve) => setTimeout(() => resolve("timer"), 25)),
        ]);
      });

      await expect(outer).resolves.toBe("timer");
      await expect(nested).resolves.toBe("inner");
    },
    1000,
  );

  it("ASM-29 — a rejected run does not kill the next one", async () => {
    const uow = createInMemoryUnitOfWork();
    const first = uow.run(async () => {
      throw new Error("boom");
    });
    const second = uow.run(async () => "ok");

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });
});
