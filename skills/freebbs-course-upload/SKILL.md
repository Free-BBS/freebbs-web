---
name: freebbs-course-upload
description: Upload course materials and images or edit knowledge maps on a FREE-BBS site using a personal course upload Token. Use for an assigned course group's publishing work, including structured Markdown knowledge points, resources, positions, connections, and map backgrounds.
---

# FREE-BBS 课程组上传

Use `scripts/freebbs_course_upload.py`; it needs only Python 3's standard library. The user generates a Token in FREE-BBS → 个人设置 → 课程组 Agent 接入. Read it from `FREEBBS_UPLOAD_TOKEN` and the site origin from `FREEBBS_BASE_URL`. Never put a Token in command arguments, generated files, console output, or source control. HTTPS is required except for localhost development.

Run `courses` to discover the courses this user currently manages. A teaching role alone does not grant course access; the administrator assigns course material managers. Each request checks the current assignment, Token expiry/revocation, and username policy. On 401/403, stop and report the account/permission issue; do not try another identity.

Read [references/api.md](references/api.md) for payload fields and advanced map routes. Publish only the courses, nodes and files in the user's requested scope. Existing user authorization to upload/edit covers these API changes; ask for a missing course/node choice when it cannot be inferred.

For knowledge content, use a JSON patch with `title`, `summary`, `sections`, and optional `position`. The three independent sections are `knowledgeMarkdown`, `basicInfoMarkdown`, and `applicationsMarkdown`. Omitted fields retain their values. An explicit empty section clears it. Read the current node before preparing content; never replace supplementary sections or layout simply because a source file omits them. The helper's `put-node` reads the current revision and refuses conflicting writes. On a 409, re-read and merge; do not automatically repeat the overwrite.

For documents, upload with `file` and add the returned Markdown link only where the user requested it. Repeating identical file content in the same course returns the existing resource. Files are publicly downloadable from the course and filenames remain visible; exclude unrelated private material. Use `image` for illustrations or backgrounds; the server converts them to WebP. The upload itself does not assign a background or insert an illustration into a node.

After a write, inspect the returned node/resource and report what changed plus its site link. On a timeout or network interruption, inspect the node revision or file list before retrying. Do not automatically retry creation of images or graph edges, which may create duplicates.
