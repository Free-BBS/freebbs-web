const fs = require('fs');
const path = require('path');
const express = require('express');
const { canReadPost } = require('./discussion-visibility');

const PRIVATE_DIRECTORY = '.max-images';
const IMAGE_NAME = /^max-image-([1-9]\d*)-\d{10,16}-[a-f0-9]{16}\.webp$/;

function imageOwner(fileName) {
  const match = IMAGE_NAME.exec(String(fileName || ''));
  const id = Number(match?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function privateImageHeaders(response) {
  response.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.vary('Authorization');
}

async function sendImage(response, directories, fileName) {
  for (const directory of directories) {
    const candidate = path.join(directory, fileName);
    const stat = await fs.promises.lstat(candidate).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    // Generated images are ordinary files, never links to another storage location.
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    response.type('webp');
    response.sendFile(
      fileName,
      {
        root: path.resolve(directory),
        dotfiles: 'deny',
        cacheControl: false,
        lastModified: false,
        acceptRanges: false,
      },
      (error) => {
        if (error && !response.headersSent) response.sendStatus(error.status === 404 ? 404 : 500);
      },
    );
    return;
  }
  response.sendStatus(404);
}

function createMaxImageAccess({ uploadDir, requireAuth, getOptionalAuthUser, pool }) {
  const privateDirectory = path.join(uploadDir, PRIVATE_DIRECTORY);
  const publicationDirectory = path.join(privateDirectory, '.publications');

  async function publishDiscussionImages(files, { ownerId, postId, commentId }) {
    for (const fileName of files) {
      if (
        imageOwner(fileName) !== Number(ownerId) ||
        ![postId, commentId].every(
          (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0,
        )
      ) {
        throw new Error('Invalid generated image publication');
      }
      const stat = await fs.promises.lstat(path.join(uploadDir, fileName));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid generated image file');
      await fs.promises.mkdir(publicationDirectory, { recursive: true });
      await fs.promises.writeFile(
        path.join(publicationDirectory, `${fileName}.json`),
        JSON.stringify({
          version: 1,
          fileName,
          ownerId: Number(ownerId),
          postId: Number(postId),
          commentId: Number(commentId),
        }),
        { flag: 'wx', mode: 0o600 },
      );
    }
  }

  async function visibleDiscussionImage(fileName, user) {
    // A persisted server-side publication record is the authority. Usernames,
    // Markdown references and model echoes cannot publish historical private files.
    const markerPath = path.join(publicationDirectory, `${fileName}.json`);
    const stat = await fs.promises.lstat(markerPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 1024) return false;
    const publication = JSON.parse(await fs.promises.readFile(markerPath, 'utf8'));
    if (
      publication.version !== 1 ||
      publication.fileName !== fileName ||
      publication.ownerId !== imageOwner(fileName) ||
      ![publication.postId, publication.commentId].every((id) => Number.isSafeInteger(id) && id > 0)
    )
      return false;
    const [rows] = await pool.execute(
      `SELECT p.user_id, p.is_deleted, p.is_hidden, p.login_required
       FROM discussion_comments c
       INNER JOIN discussion_posts p ON p.id = c.post_id
       WHERE c.id = ? AND c.post_id = ? AND c.is_deleted = 0
         AND LOCATE(?, c.content_markdown) > 0 LIMIT 1`,
      [publication.commentId, publication.postId, `](/uploads/${fileName})`],
    );
    return rows.some((post) => canReadPost(post, user));
  }

  const router = express.Router();
  router.get('/:fileName', async (request, response) => {
    privateImageHeaders(response);
    try {
      const user = await requireAuth(request, response);
      if (!user) return;
      const { fileName } = request.params;
      if (imageOwner(fileName) !== Number(user.id)) return response.sendStatus(404);
      // Old conversation Markdown can keep its filename; ownership is checked
      // before trying the historical public-directory location.
      await sendImage(response, [privateDirectory, uploadDir], fileName);
    } catch {
      if (!response.headersSent) response.sendStatus(503);
    }
  });

  async function guardUploads(request, response, next) {
    try {
      const normalized = path.posix.normalize(decodeURIComponent(request.path).replace(/\\/g, '/'));
      const parts = normalized.split('/').filter(Boolean);
      if (
        parts.some(
          (part) =>
            /~\d/i.test(part) || part.replace(/[ .]+$/g, '').toLowerCase() === PRIVATE_DIRECTORY,
        )
      ) {
        privateImageHeaders(response);
        return response.sendStatus(404);
      }
      const fileName = parts[parts.length - 1] || '';
      // Case-insensitive prefix guard also covers Windows case/ADS/trailing-dot aliases.
      if (!/^max-image-/i.test(fileName)) return next();
      privateImageHeaders(response);
      if (parts.length !== 1 || !imageOwner(fileName)) return response.sendStatus(404);
      const optionalUser = await getOptionalAuthUser(request);
      if (await visibleDiscussionImage(fileName, optionalUser)) {
        return await sendImage(response, [uploadDir], fileName);
      }
      const user = await requireAuth(request, response);
      if (!user) return;
      if (imageOwner(fileName) !== Number(user.id)) return response.sendStatus(404);
      return await sendImage(response, [privateDirectory, uploadDir], fileName);
    } catch {
      if (!response.headersSent) response.sendStatus(503);
    }
  }

  return { router, guardUploads, publishDiscussionImages };
}

module.exports = { createMaxImageAccess, imageOwner, PRIVATE_DIRECTORY };
