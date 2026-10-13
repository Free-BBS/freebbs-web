# Publishing routes

Mount `createPublishingRouter(options)` at `/publishing`. Authenticated list and detail responses use API envelopes. POST creates drafts, PATCH requires a revision, and POST `/:id/reaction` requires a revision with `liked` or a 1–5 book rating. All mutation data is bounded to 64 KiB. Production requires an absolute uploadDirectory. Contacts are always department restricted and manually authored.

The frontend exports PublishingPage (optional notices/experience book selection) and PublishingShelf. Mount at `/collections/publishing` and `/collections/publishing/:contentId`. Existing showcase endpoints and likes remain intact.
