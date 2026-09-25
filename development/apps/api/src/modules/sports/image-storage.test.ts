import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSportsImageStorage } from './image-storage.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('sports image storage', () => {
  it('uses the configured writable directory instead of the application working directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'freebbs-sports-images-'));
    temporaryDirectories.push(root);
    const configured = join(root, 'uploads', 'sports');

    const storage = createSportsImageStorage(configured);

    expect(storage.directory).toBe(configured);
    expect(existsSync(configured)).toBe(true);
    expect(storage.imagePath('12345678-1234-1234-1234-123456789abc.image')).toBe(
      join(configured, '12345678-1234-1234-1234-123456789abc.image'),
    );
  });
});
