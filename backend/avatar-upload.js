const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_PIXELS = 36 * 1000 * 1000;
const AVATAR_SIZE = 512;
const MIME_FORMATS = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

class AvatarUploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AvatarUploadError';
    this.status = status;
  }
}

async function normalizeAvatar(imageDataUrl) {
  if (typeof imageDataUrl !== 'string') {
    throw new AvatarUploadError('请上传 PNG、JPG、WEBP 或 GIF 图片');
  }
  if (imageDataUrl.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 64) {
    throw new AvatarUploadError('头像大小需在 5MB 以内');
  }
  const match = imageDataUrl.match(
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/,
  );
  if (!match) {
    throw new AvatarUploadError('请上传 PNG、JPG、WEBP 或 GIF 图片');
  }
  const input = Buffer.from(match[2], 'base64');
  if (!input.length || input.length > MAX_AVATAR_BYTES) {
    throw new AvatarUploadError('头像大小需在 5MB 以内');
  }
  // Buffer.from accepts malformed base64. Require a complete, canonical encoding.
  if (input.toString('base64') !== match[2]) {
    throw new AvatarUploadError('图片数据不完整，请重新选择图片');
  }

  try {
    const image = sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== MIME_FORMATS[match[1]]) {
      throw new AvatarUploadError('图片内容与文件格式不一致，请重新选择图片');
    }
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_AVATAR_PIXELS ||
      metadata.width > 12000 ||
      metadata.height > 12000
    ) {
      throw new AvatarUploadError('图片尺寸过大，请选择不超过 3600 万像素的图片');
    }
    // Decode before writing, apply EXIF orientation, strip metadata, and use the
    // first frame only. Every stored avatar is a bounded, static WebP image.
    const buffer = await image
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    return { buffer, animated: Number(metadata.pages || 1) > 1 };
  } catch (error) {
    if (error instanceof AvatarUploadError) throw error;
    if (/pixel limit/i.test(error.message)) {
      throw new AvatarUploadError('图片尺寸过大，请选择不超过 3600 万像素的图片');
    }
    throw new AvatarUploadError('无法读取图片，请选择完整有效的 PNG、JPG、WEBP 或 GIF 图片');
  }
}

function ownedAvatarFileName(avatarPath, userId) {
  if (typeof avatarPath !== 'string') return null;
  const match = avatarPath.match(
    /^\/uploads\/(user-(\d+)-(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:png|jpg|jpeg|webp|gif))$/i,
  );
  return match && match[2] === String(userId) ? match[1] : null;
}

function createAvatarUploadService({
  uploadDir,
  store,
  files = fs.promises,
  processImage = normalizeAvatar,
  createId = crypto.randomUUID,
  onCleanupError = () => {},
}) {
  async function removeOwned(avatarPath, userId) {
    const fileName = ownedAvatarFileName(avatarPath, userId);
    if (!fileName) return;
    try {
      await files.unlink(path.join(uploadDir, fileName));
    } catch (error) {
      if (error.code !== 'ENOENT') onCleanupError(error);
    }
  }

  return async function uploadAvatar({ userId, imageDataUrl }) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
      throw new AvatarUploadError('用户不存在', 401);
    }
    const normalized = await processImage(imageDataUrl);
    const fileName = `user-${userId}-${createId()}.webp`;
    const avatarPath = `/uploads/${fileName}`;
    let wroteFile = false;
    let replacement;
    try {
      await files.writeFile(path.join(uploadDir, fileName), normalized.buffer, { flag: 'wx' });
      wroteFile = true;
      replacement = await store.replace({ userId, avatarPath });
    } catch (error) {
      // A failed COMMIT may have succeeded on the database server. Check before
      // cleanup; if the outcome cannot be read, retain the file rather than break
      // an avatar that may already be in use.
      if (wroteFile || error.code !== 'EEXIST') {
        try {
          if (!(await store.isCurrent({ userId, avatarPath }))) {
            await removeOwned(avatarPath, userId);
          }
        } catch (checkError) {
          onCleanupError(checkError);
        }
      }
      throw error;
    }
    if (replacement.previousAvatarPath !== avatarPath) {
      await removeOwned(replacement.previousAvatarPath, userId);
    }
    return { user: replacement.user, animated: normalized.animated };
  };
}

function createMysqlAvatarStore({ pool, createUserUid }) {
  return {
    async replace({ userId, avatarPath }) {
      // Generate outside the transaction so even a one-connection pool can work.
      const uid = await createUserUid();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          'SELECT id, avatar_path FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
          [userId],
        );
        if (!rows[0]) throw new AvatarUploadError('用户不存在', 401);
        const previousAvatarPath = rows[0].avatar_path;
        await connection.execute(
          `UPDATE users
           SET uid = COALESCE(NULLIF(uid, ''), ?), avatar_path = ?
           WHERE id = ?`,
          [uid, avatarPath, userId],
        );
        const [updatedRows] = await connection.execute(
          `SELECT id, uid, username, full_name, student_id, email, email_verified_at,
                  role, is_admin, electrons, manetrons, heat, grade, major, avatar_path,
                  bio, website_url, created_at
           FROM users WHERE id = ? LIMIT 1`,
          [userId],
        );
        if (!updatedRows[0]) throw new AvatarUploadError('用户不存在', 401);
        await connection.commit();
        return { previousAvatarPath, user: updatedRows[0] };
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
    async isCurrent({ userId, avatarPath }) {
      const [rows] = await pool.execute('SELECT avatar_path FROM users WHERE id = ? LIMIT 1', [
        userId,
      ]);
      return rows[0]?.avatar_path === avatarPath;
    },
  };
}

module.exports = {
  AVATAR_SIZE,
  MAX_AVATAR_BYTES,
  MAX_AVATAR_PIXELS,
  AvatarUploadError,
  normalizeAvatar,
  ownedAvatarFileName,
  createAvatarUploadService,
  createMysqlAvatarStore,
};
