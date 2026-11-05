import type { Errors, Operation, PredicateName } from "contracts";

export type Checked =
  | { readonly ok: true; readonly operation: Operation }
  | { readonly ok: false; readonly errors: Errors };

const fields = ["op_id", "note_id", "base_revision", "text"] as const;
type Field = (typeof fields)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExtraEnumerableOwnKey(value: Record<string, unknown>): boolean {
  const allowed = new Set<PropertyKey>(fields);
  for (const key of Reflect.ownKeys(value)) {
    if (!Object.getOwnPropertyDescriptor(value, key)?.enumerable) continue;
    if (!allowed.has(key)) return true;
  }
  return false;
}

function fieldOk(field: Field, value: unknown): boolean {
  if (field === "base_revision") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
  if (field === "text") return typeof value === "string";
  return typeof value === "string" && value.trim().length >= 1;
}

export function check(payload: unknown): Checked {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ["not_plain_object"] };
  }

  const errors: PredicateName[] = [];
  if (hasExtraEnumerableOwnKey(payload)) errors.push("extra_keys");
  for (const field of fields) {
    if (!Object.hasOwn(payload, field) || !fieldOk(field, payload[field])) {
      errors.push(field);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors: [errors[0], ...errors.slice(1)] };
  }

  return {
    ok: true,
    operation: {
      op_id: payload.op_id as Operation["op_id"],
      note_id: payload.note_id as Operation["note_id"],
      base_revision: payload.base_revision as Operation["base_revision"],
      text: payload.text as Operation["text"],
    },
  };
}
