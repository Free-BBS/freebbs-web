---
name: freebbs-course-upload
description: Create or update course-map knowledge points from Markdown, arrange their positions and connections, and upload course materials and images on a FREE-BBS site using a personal course upload Token. Use for an assigned course group's publishing work, including knowledge maps and map backgrounds.
---

# FREE-BBS 课程组上传

Use `scripts/freebbs_course_upload.py`; it needs only Python 3's standard library. The user generates a Token in FREE-BBS → 个人设置 → 课程组 Agent 接入. Read it from `FREEBBS_UPLOAD_TOKEN` and the site origin from `FREEBBS_BASE_URL`. Never put a Token in command arguments, generated files, console output, or source control. HTTPS is required except for localhost development.

Run `courses` to discover the courses this user currently manages. A teaching role alone does not grant course access; the administrator assigns course material managers. Each request checks the current assignment, Token expiry/revocation, and username policy. On 401/403, stop and report the account/permission issue; do not try another identity.

Read [references/api.md](references/api.md) for payload fields and advanced map routes. Publish only the courses, nodes and files in the user's requested scope. Existing user authorization to upload/edit covers these API changes; ask for a missing course/node choice when it cannot be inferred.

## Publish course-map knowledge points

Use `upload-node COURSE NODE_ID MARKDOWN_FILE` to publish a UTF-8 Markdown file directly as a knowledge point's main content (`knowledgeMarkdown`) on the course map. This is the command for creating or updating the map's knowledge content. The `file` command only publishes a downloadable attachment.

1. Run `map COURSE` to inspect existing node IDs, positions and connections. For a new node, choose an unused ID and a position with enough space around nearby nodes; include `--title`, `--x`, `--y` and `--expected-revision new`.
2. For an existing node, run `get-node COURSE NODE_ID` before preparing the changes. Save its `node.revision` and pass that value with `--expected-revision` when uploading. Omit metadata or positions that the user did not ask to change.
3. The main Markdown file replaces only `knowledgeMarkdown`. Use `--basic-info FILE` or `--applications FILE` when the user requests changes to those independent sections; omitted sections retain their values. Explicitly supplying an empty file clears that section. Never replace supplementary sections or layout simply because a source document omits them.
4. After both nodes exist, use `connect COURSE SOURCE TARGET --type ordered` for a directional learning path or `--type related` for a related-knowledge connection. Inspect the map first and add only the connections requested by the user.

```sh
python3 scripts/freebbs_course_upload.py map signals
python3 scripts/freebbs_course_upload.py upload-node signals SS-03-01 fourier.md \
  --title "傅里叶变换" --summary "时域与频域的桥梁" \
  --x 960 --y 320 --expected-revision new
python3 scripts/freebbs_course_upload.py connect signals SS-01-01 SS-03-01 --type ordered
```

The IDs and position above are examples; use the course's existing naming and layout. `upload-node` reads the current revision by default, but pass the revision from the earlier read when content preparation may take time. On a 409, stop, re-read and merge the user's intended changes; do not automatically repeat the overwrite. `put-node COURSE NODE_ID JSON_FILE` remains available for a JSON patch with `title`, `summary`, `sections`, optional `position`, and `expectedRevision`; omitted fields and individual coordinates are preserved.

For documents, upload with `file` and add the returned Markdown link only where the user requested it. Repeating identical file content in the same course returns the existing resource. Files are publicly downloadable from the course and filenames remain visible; exclude unrelated private material. Use `image COURSE IMAGE_FILE` for illustrations or backgrounds; the server converts them to WebP. To illustrate a knowledge point, insert the returned `markdown` into its Markdown file and publish it with `upload-node`. The image upload itself does not assign a background or insert an illustration into a node.

After a write, inspect the returned node/resource and report what changed plus its site link. On a timeout or network interruption, inspect the node revision or file list before retrying. Do not automatically retry creation of images or graph edges, which may create duplicates.
