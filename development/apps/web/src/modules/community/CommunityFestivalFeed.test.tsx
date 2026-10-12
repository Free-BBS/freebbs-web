import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FestivalSubmission } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { CommunityFestivalFeed } from './CommunityFestivalFeed.js';

const approved: FestivalSubmission = {
  id: 'festival-approved',
  title: '校园合奏',
  description: '来自校园的一首歌。',
  authorName: '同学甲',
  ownerUid: 'student-1',
  status: 'approved',
  displayConsent: true,
  mimeType: 'video/webm',
  sizeBytes: 1024,
  createdAt: '2026-10-08T08:00:00Z',
  updatedAt: '2026-10-08T08:00:00Z',
  reviewedAt: '2026-10-08T09:00:00Z',
  reviewNote: '',
  canViewMedia: true,
};

describe('CommunityFestivalFeed', () => {
  it('uses the real festival showcase and displays only consented approved submissions', async () => {
    const request = vi.fn().mockResolvedValue({
      items: [
        approved,
        {
          ...approved,
          id: 'private',
          title: '私密作品',
          status: 'private',
          displayConsent: false,
        },
        { ...approved, id: 'pending', title: '待审作品', status: 'pending' },
      ],
      total: 3,
      page: 1,
      pageSize: 12,
    });
    render(<CommunityFestivalFeed client={{ request } as unknown as ApiClient} />);
    expect(await screen.findByRole('heading', { name: approved.title })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/events/festival/submissions?view=showcase&page=1');
    expect(screen.queryByText('私密作品')).not.toBeInTheDocument();
    expect(screen.queryByText('待审作品')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看电子系春晚作品' })).toHaveAttribute(
      'href',
      '/development/events/student-festival',
    );
    expect(screen.queryByRole('button', { name: /赞|回复/ })).not.toBeInTheDocument();
  });
});
