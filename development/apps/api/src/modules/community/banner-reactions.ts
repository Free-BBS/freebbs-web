import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PUBLISHED_FESTIVAL_BANNER_IDS,
  type BannerReactions,
  type UpdateBannerReactionsInput,
} from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import { bannerReactionsDataDirectory } from './banner-reaction-directory.js';

interface StoredBannerReactions {
  id: string;
  likes: string[];
  blessings: string[];
}

function storageError(error: unknown): HttpError {
  // A missing record is handled by featureStorage. Permission, volume and
  // malformed-storage failures must not look like an identity rejection or
  // expose the private filename through an operating-system error message.
  if (error instanceof HttpError) return error;
  return new HttpError(503, 'banner_storage_unavailable', '横幅互动暂时不可用，请稍后再试');
}

export class BannerReactionsService {
  private readonly storage: ReturnType<typeof featureStorage<StoredBannerReactions>> | null;
  private readonly directory: string | undefined;
  private readonly configurationProblem: HttpError | null;
  private storageProblem: HttpError | null = null;
  private checking: Promise<void> | null = null;

  constructor(
    options: {
      directory?: string;
      nodeEnvironment?: string;
      publicDirectories?: readonly string[];
      configurationIssue?: string;
    } = {},
  ) {
    let directory: string | undefined;
    let problem: HttpError | null = null;
    try {
      if (options.configurationIssue)
        throw new HttpError(
          503,
          options.configurationIssue === 'ambiguous_storage'
            ? 'banner_storage_configuration_conflict'
            : 'banner_storage_unavailable',
          options.configurationIssue === 'ambiguous_storage'
            ? '横幅互动存储配置需要确认，请稍后再试'
            : '横幅互动暂时不可用，请稍后再试',
        );
      directory = bannerReactionsDataDirectory(options);
    } catch (error) {
      problem =
        error instanceof HttpError
          ? error
          : new HttpError(503, 'banner_storage_not_configured', '横幅互动暂未配置，请稍后再试');
    }
    this.directory = directory;
    this.configurationProblem = problem;
    this.storage = directory
      ? featureStorage<StoredBannerReactions>(directory, 'banner-reactions')
      : null;
  }

  /** Startup/readiness only: check the real service account without touching counts. */
  async checkReadiness(): Promise<void> {
    if (this.configurationProblem) throw this.configurationProblem;
    if (!this.storage || !this.directory)
      throw new HttpError(503, 'banner_storage_not_configured', '横幅互动暂未配置，请稍后再试');
    if (this.checking) return this.checking;
    const directory = this.directory;
    const task = (async () => {
      let probe: string | undefined;
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const namespace = join(directory, 'banner-reactions');
        let probeDirectory = directory;
        try {
          const info = await stat(namespace);
          if (!info.isDirectory()) throw new Error('Invalid private storage directory');
          probeDirectory = namespace;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        probe = join(probeDirectory, `.readiness-${randomUUID()}.tmp`);
        const handle = await open(probe, 'wx', 0o600);
        try {
          await handle.writeFile('banner-storage-readiness');
        } finally {
          await handle.close();
        }
        await rm(probe);
        probe = undefined;
        this.storageProblem = null;
      } catch (error) {
        this.storageProblem = storageError(error);
        throw this.storageProblem;
      } finally {
        if (probe) await rm(probe, { force: true }).catch(() => undefined);
      }
    })();
    this.checking = task;
    try {
      await task;
    } finally {
      if (this.checking === task) this.checking = null;
    }
  }

  private configured(bannerId: string) {
    if (!PUBLISHED_FESTIVAL_BANNER_IDS.includes(bannerId))
      throw new HttpError(404, 'banner_not_published', '横幅未发布或已下线');
    if (this.configurationProblem) throw this.configurationProblem;
    if (this.storageProblem) throw this.storageProblem;
    if (!this.storage)
      throw new HttpError(503, 'banner_storage_not_configured', '横幅互动暂未配置，请稍后再试');
    return this.storage;
  }

  private readerKey(uid: string) {
    return createHash('sha256').update(uid).digest('hex');
  }

  private view(record: StoredBannerReactions, uid: string): BannerReactions {
    const key = this.readerKey(uid);
    return {
      bannerId: record.id,
      likeCount: record.likes.length,
      liked: record.likes.includes(key),
      blessingCount: record.blessings.length,
      blessed: record.blessings.includes(key),
    };
  }

  async read(bannerId: string, uid: string): Promise<BannerReactions> {
    const storage = this.configured(bannerId);
    try {
      const record = (await storage.get(bannerId)) ?? {
        id: bannerId,
        likes: [],
        blessings: [],
      };
      return this.view(record, uid);
    } catch (error) {
      throw storageError(error);
    }
  }

  async update(
    bannerId: string,
    uid: string,
    input: UpdateBannerReactionsInput,
  ): Promise<BannerReactions> {
    const storage = this.configured(bannerId);
    try {
      return await storage.change(bannerId, (stored) => {
        const record = stored ?? { id: bannerId, likes: [], blessings: [] };
        const key = this.readerKey(uid);
        if (input.liked === true && !record.likes.includes(key)) record.likes.push(key);
        if (input.liked === false) record.likes = record.likes.filter((reader) => reader !== key);
        if (input.blessed === true && !record.blessings.includes(key)) record.blessings.push(key);
        return { record, result: this.view(record, uid) };
      });
    } catch (error) {
      throw storageError(error);
    }
  }
}
