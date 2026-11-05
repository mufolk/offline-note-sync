/**
 * Shapes only. ProcessResult and QueryResult are separate unions (ASM-32).
 */

/** ASM-04, REQ-22. Exactly these three fields. */
export type Note = {
  readonly id: string;
  readonly text: string;
  readonly revision: number;
};

/**
 * ASM-14, the shape half. Compared with === per field in a later stage.
 * op_id is the key, never part of this fingerprint.
 */
export type Content = {
  readonly note_id: string;
  readonly base_revision: number;
  readonly text: string;
};

/** REQ-02. The fingerprint plus its key. */
export type Operation = Content & {
  readonly op_id: string;
};

/** ASM-38, ASM-18. text is the text as stored; revision is the revision after apply. */
export type Accepted = {
  readonly type: "accepted";
  readonly op_id: string;
  readonly note_id: string;
  readonly text: string;
  readonly revision: number;
};

/**
 * ASM-18. server_text and client_text are two keys.
 * text stays on Note, on Accepted, and on Found.
 */
export type Conflict = {
  readonly type: "conflict";
  readonly op_id: string;
  readonly note_id: string;
  readonly base_revision: number;
  readonly server_text: string;
  readonly server_revision: number;
  readonly client_text: string;
};

/** ASM-20, ASM-19. No server_text and no server_revision. */
export type NoteNotFound = {
  readonly type: "note_not_found";
  readonly op_id: string;
  readonly note_id: string;
  readonly base_revision: number;
  readonly client_text: string;
};

/** ASM-40. The code and the key. Nothing else. */
export type IdReused = {
  readonly type: "id_reused";
  readonly op_id: string;
};

/**
 * ASM-41. Names only, never values. Closed here: a string outside this union
 * is not an error the protocol can report.
 */
export type PredicateName =
  | "not_plain_object"
  | "extra_keys"
  | "op_id"
  | "note_id"
  | "base_revision"
  | "text";

/** At least one name. An empty list would be a failure with no reason. */
export type Errors = readonly [PredicateName, ...PredicateName[]];

/** ASM-41. No op_id: this result must not read as a reservation. */
export type Invalid = {
  readonly type: "invalid";
  readonly errors: Errors;
};

/**
 * Guards `Errors`. `{ type: "invalid", errors: [] }` must not compile, and a
 * list of one or two predicate names must. This is the only check that
 * enforces it — deleting these two lines makes an empty failure legal again.
 */
type Expect<T extends true> = T;
type _InvalidNeedsAReason = Expect<
  ([] extends Invalid["errors"] ? false : true) &
    (readonly ["op_id"] extends Invalid["errors"] ? true : false) &
    (readonly ["op_id", "note_id"] extends Invalid["errors"] ? true : false) &
    ("not_plain_object" extends PredicateName ? true : false) &
    ("timestamp" extends PredicateName ? false : true)
>;

export type ProcessResult =
  | Accepted
  | Conflict
  | NoteNotFound
  | IdReused
  | Invalid;

/** ASM-33. Not Invalid, and there is no op_id to resend. */
export type Malformed = {
  readonly type: "malformed";
};

/** ASM-34. Live absence. Not a note_not_found receipt. */
export type Absent = {
  readonly type: "absent";
  readonly note_id: string;
};

/** ASM-35. note_id echoes the argument. No id, no timestamp, no receipts. */
export type Found = {
  readonly type: "found";
  readonly note_id: string;
  readonly text: string;
  readonly revision: number;
};

/** ASM-32. Outside the operation taxonomy. */
export type QueryResult = Malformed | Absent | Found;
