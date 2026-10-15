---
name: freebbs-course-upload
description: Create or update course-map knowledge points from Markdown, arrange their positions and connections, and upload course materials and images on a FREE-BBS site using a personal course upload Token. Use for an assigned course group's publishing work, including knowledge maps and map backgrounds.
---

# FREE-BBS 课程组上传

The user generates a Token in FREE-BBS → 个人设置 → 课程组 Agent 接入. Read it from `FREEBBS_UPLOAD_TOKEN` and the site origin from `FREEBBS_BASE_URL` (production: `https://www.free-bbs.cn`). Never put a Token in command arguments, generated files, console output, or source control. HTTPS is required except for localhost development.

Use the Node.js 18+ tools in `scripts/course-authoring/` for complete three-section authoring templates and course-source downloads. The same tools live under `tools/` in the public authoring template ZIP, together with `README.md`, writing guidance, templates and examples. These additions are maintained in PR #180; verify the deployed package actually contains them before advertising an available production flow. Preserve the existing `scripts/freebbs_course_upload.py` commands, which need only Python 3's standard library, for independent-section updates, JSON patches, materials, images and map operations.

Run `courses` to discover the courses this user currently manages. A teaching role alone does not grant course access; the administrator assigns course material managers. Each request checks the current assignment, Token expiry/revocation, and username policy. On 401/403, stop and report the account/permission issue; do not try another identity.

Read [references/api.md](references/api.md) for payload fields and advanced map routes. Publish only the courses, nodes and files in the user's requested scope. Existing user authorization to upload/edit covers these API changes; ask for a missing course/node choice when it cannot be inferred.

## Publish course-map knowledge points

### Download complete current author sources

Before preparing existing-node changes, inspect the authorized course list and download that course to a new directory:

```sh
python3 scripts/freebbs_course_upload.py courses
node scripts/course-authoring/下载课程.cjs signals --out course-before-20261012
```

This command issues GET requests only. It preserves the course map and each node's raw author JSON, complete three sections (including author grading configuration), position and revision. Output includes `课程地图原始.json`, `知识点/ID/{节点原始.json,revision.txt,基本信息.md,背景与应用.md,正文.md}`, and `快照清单.json` only after all nodes are saved. The output directory must not exist; it never overwrites files. Requests are validated before local writes; a local write failure may leave partial files, which are not a complete snapshot. Use a different new directory when retrying. The map is checked again, but individual node reads are not a database-transaction snapshot and do not guarantee one common point-in-time version. It does not retrieve student attempts, private annotations or chats, download image/attachment binaries, create complete templates from legacy sections, or invent missing metadata.

Public student-facing exports may omit grading configuration and answers; never treat them as complete author backups or use them to overwrite official sources. Downloaded section files are not complete author templates. Preserve original IDs and contents, and ask the course group to supply missing actual chapter names, origin explanations, attribution and review decisions. Do not fill in invented authors, reviewers or publication status merely to pass validation.

### Publish one complete authoring template

The complete Markdown template has the three exact sections `## 0. 基本信息`, `## 1. 知识背景与应用`, and `## 2. 知识点正文`. The Node publisher reads the destination from its `课程标识` and `知识点ID` fields; verify both before publication. It validates locally and checks the current author revision with GET by default. Pass the earlier 64-character revision from preparation, not a freshly fetched value that conceals intervening changes.

```sh
node scripts/course-authoring/上传知识点.cjs complete-node.md --revision "EARLIER_64_CHARACTER_REVISION"
node scripts/course-authoring/上传知识点.cjs complete-node.md --revision "EARLIER_64_CHARACTER_REVISION" --publish
node scripts/course-authoring/上传知识点.cjs new-node.md --revision new --x 200 --y 180
```

Only an explicit `--publish` permits one PUT, followed by a GET that verifies the stored result. New nodes need `--revision new` and both coordinates (zero is valid); they also require `--publish` to write. For existing nodes, omitted coordinates preserve the current position. A complete template replaces all three sections, title and summary, not only main content, and never automatically updates edges or publishes other files. Use the old independent-section commands below if the user requested only one section.

Do not publish until the user has authorized the actual scope and the course group has completed its teaching/source review. Format checks are not evidence that content, answers or historical claims are correct. Node content becomes visible after saving; the quiz extension's `draft` status does not hide the whole document. Do not automatically mark a quiz `published`, add false review evidence, or manufacture stars or pass records.

On 401/403/409, stop. For 409, re-read and reconcile the earlier source with the requested edits; do not force or automatically repeat an overwrite. If PUT times out or verification fails, inspect the actual node before deciding whether a write succeeded; never blindly retry or claim no write occurred. Download operations and default publisher validation are read-only, but `--publish` is a production content change.

### Existing Python single-section and JSON flow

Use `upload-node COURSE NODE_ID MARKDOWN_FILE` to publish a UTF-8 Markdown file directly as a knowledge point's main content (`knowledgeMarkdown`) on the course map. It does not parse the complete three-section template; passing the full template here would misplace metadata and origin sections into the body. The `file` command only publishes a downloadable attachment and does not import a knowledge point.

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
