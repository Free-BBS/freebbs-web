import { createHash } from 'node:crypto';
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

export class BannerReactionsService {
  private readonly storage: ReturnType<typeof featureStorage<StoredBannerReactions>> | null;

  constructor(
    options: {
      directory?: string;
      nodeEnvironment?: string;
      publicDirectories?: readonly string[];
    } = {},
  ) {
    const directory = bannerReactionsDataDirectory(options);
    this.storage = directory
      ? featureStorage<StoredBannerReactions>(directory, 'banner-reactions')
      : null;
  }

  private configured(bannerId: string) {
    if (!PUBLISHED_FESTIVAL_BANNER_IDS.includes(bannerId))
      throw new HttpError(404, 'banner_not_published', '横幅未发布或已下线');
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
    const record = (await this.configured(bannerId).get(bannerId)) ?? {
      id: bannerId,
      likes: [],
      blessings: [],
    };
    return this.view(record, uid);
  }

  async update(
    bannerId: string,
    uid: string,
    input: UpdateBannerReactionsInput,
  ): Promise<BannerReactions> {
    return this.configured(bannerId).change(bannerId, (stored) => {
      const record = stored ?? { id: bannerId, likes: [], blessings: [] };
      const key = this.readerKey(uid);
      if (input.liked === true && !record.likes.includes(key)) record.likes.push(key);
      if (input.liked === false) record.likes = record.likes.filter((reader) => reader !== key);
      if (input.blessed === true && !record.blessings.includes(key)) record.blessings.push(key);
      return { record, result: this.view(record, uid) };
    });
  }
}
