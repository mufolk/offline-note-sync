# Offline note sync

People edit the same note on devices that spend time offline. When those devices reconnect, the server has to accept a change, reject it, or keep both versions. It must not overwrite one person's text with the other's and call that a save.

This repository is the in-memory core of that server. A client and the server run in one process. There is no HTTP API, no database, and no user interface.

A note is an id, a text, and a revision number. The server starts with none. A client operation carries its own id, the note id, the revision the client last saw, and the text it wants to store.

A new note is created at revision 1 when the client sends base revision 0. A later edit is accepted only when that base revision is the revision the server holds now. An accepted edit replaces the text and adds 1 to the revision, even when the text did not change.

When the base revision does not match, the server returns a conflict and keeps the note as it is. The result holds both the server's text and the client's proposal. The two texts are not merged, and the clock is not used to pick a winner. If the note does not exist yet and the base revision is already past zero, the result says the note was not found, and it still keeps the client's text.

Every operation is checked before it is processed. A payload that fails that check does not occupy its operation id, so the client can fix it and send it again. A valid operation is stored with its result the first time it arrives, including when the result is a conflict. Sending the same id again with the same content returns that stored result and does not apply the edit a second time. The stored result can be stale: it is the receipt of the original operation, not a live read. A separate query returns the note as it is now. Sending the same id with different content is an error, and the error does not reveal the stored receipt.

The server processes a batch in the order it was received and returns one result per operation. A conflict or an error in the middle does not stop the rest. Resolving a conflict is another operation: a new id, the text the client chose, and the revision the server holds now.

That is the whole problem. The choices it does not make — what "content" means, what a conflict error carries, how long a receipt is kept — are in `docs/assumptions.md`. The numbered rules and the tests that prove them are in `docs/reqs.md`.
