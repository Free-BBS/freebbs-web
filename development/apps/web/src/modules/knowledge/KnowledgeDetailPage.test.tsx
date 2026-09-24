import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeDetailPage } from './KnowledgeDetailPage.js';

const entry = {
  id: 'entry-1',
  title: '活动交接指南',
  body: '第一步：确认负责人。\n第二步：移交材料。',
  summary: '让交接有条不紊。',
  type: 'workflow',
  status: 'published',
  tags: ['交接'],
  audience: 'general',
  maintainedAt: '2026-09-14T00:00:00.000Z',
};

describe('KnowledgeDetailPage', () => {
  it('loads a direct entry and renders its full body with a return link', async () => {
    const request = vi.fn().mockResolvedValue([entry]);
    render(
      <MemoryRouter>
        <KnowledgeDetailPage entryId="entry-1" client={{ request }} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: entry.title })).toBeInTheDocument();
    expect(screen.getByLabelText('经验正文')).toHaveTextContent(
      '第一步：确认负责人。 第二步：移交材料。',
    );
    expect(screen.getByRole('link', { name: '返回经验库' })).toHaveAttribute('href', '/knowledge');
    expect(request).toHaveBeenCalledWith('/knowledge/entries?audience=general');
  });

  it('preserves the protected audience when reading and returning', async () => {
    const request = vi.fn().mockResolvedValue([{ ...entry, audience: 'social_org' }]);
    render(
      <MemoryRouter>
        <KnowledgeDetailPage entryId="entry-1" audience="social_org" client={{ request }} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: entry.title });
    expect(request).toHaveBeenCalledWith('/knowledge/entries?audience=social_org');
    expect(screen.getByRole('link', { name: '返回经验库' })).toHaveAttribute(
      'href',
      '/knowledge?audience=social_org',
    );
  });

  it('does not display a record that is absent from the authorized result', async () => {
    const request = vi.fn().mockResolvedValue([{ ...entry, id: 'different' }]);
    render(
      <MemoryRouter>
        <KnowledgeDetailPage entryId="entry-1" client={{ request }} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: '暂时无法查看这篇经验' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('经验正文')).not.toBeInTheDocument();
  });

  it('can retry a failed request without showing unconfirmed content', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([entry]);
    render(
      <MemoryRouter>
        <KnowledgeDetailPage entryId="entry-1" client={{ request }} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: entry.title })).toBeInTheDocument();
  });

  it('ignores an old response after the requested entry changes', async () => {
    let finishOld!: (value: unknown[]) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce([{ ...entry, id: 'entry-2', title: '最新经验' }]);
    const { rerender } = render(
      <MemoryRouter>
        <KnowledgeDetailPage entryId="entry-1" client={{ request }} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <KnowledgeDetailPage entryId="entry-2" client={{ request }} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '最新经验' });
    await act(async () => finishOld([entry]));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: entry.title })).not.toBeInTheDocument(),
    );
  });
});
