import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { UserContext } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
import { AnnouncementsPage } from './AnnouncementsPage.js';
import { ConsultationsPage } from './ConsultationsPage.js';
import { TriagePage } from './TriagePage.js';
import { InformationLayout } from './InformationLayout.js';

const student: UserContext = {
  uid: 'student-1',
  displayName: '林同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
const triageUser: UserContext & { policies: Array<{ action: string; effect: 'allow' }> } = {
  ...student,
  uid: 'triage-1',
  policies: [{ action: 'information.consultation.triage', effect: 'allow' }],
};

const announcement = {
  id: 'announcement-1',
  title: '开放时间调整',
  body: '周末正常开放。',
  status: 'published',
  ownerUid: 'admin-1',
  scope: { type: 'public', id: '*' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
const consultation = {
  id: 'consultation-1',
  title: '场地预约咨询',
  body: '需要预约流程。',
  status: 'open',
  requesterUid: 'student-1',
  assigneeUid: 'triage-1',
  reply: '请提交表单。',
  ownerUid: 'student-1',
  scope: { type: 'user', id: 'student-1' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function clientFor(request: ReturnType<typeof vi.fn>) {
  return { request } as unknown as ApiClient;
}

function renderRoutePage(children: ReactNode) {
  return render(<MemoryRouter>{children}</MemoryRouter>);
}

describe('focused information route adapters', () => {
  it('keeps triage navigation hidden for ordinary students', () => {
    renderRoutePage(
      <InformationLayout title="公开信息" user={student}>
        <p>内容</p>
      </InformationLayout>,
    );

    expect(screen.getByRole('link', { name: '公开信息' })).toHaveAttribute(
      'href',
      '/information/announcements',
    );
    expect(screen.queryByRole('link', { name: '分诊' })).not.toBeInTheDocument();
  });

  it('shows triage navigation for authorized queue members', () => {
    renderRoutePage(
      <InformationLayout title="咨询分诊" user={triageUser}>
        <p>内容</p>
      </InformationLayout>,
    );

    expect(screen.getByRole('link', { name: '分诊' })).toHaveAttribute(
      'href',
      '/information/triage',
    );
  });
  it('shows only announcements and requests only announcement data', async () => {
    const request = vi.fn(async (path: string) => {
      if (path !== '/information/announcements') throw new Error(`unexpected path: ${path}`);
      return [announcement];
    });

    renderRoutePage(<AnnouncementsPage client={clientFor(request)} user={student} />);

    expect(await screen.findByText('开放时间调整')).toBeInTheDocument();
    expect(screen.queryByText('提交咨询')).not.toBeInTheDocument();
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/information/announcements']);
  });

  it('shows only consultations and requests only consultation data', async () => {
    const request = vi.fn(async (path: string) => {
      if (path !== '/information/consultations') throw new Error(`unexpected path: ${path}`);
      return [consultation];
    });

    renderRoutePage(<ConsultationsPage client={clientFor(request)} user={student} />);

    expect(await screen.findByText('场地预约咨询')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '公开信息' })).not.toBeInTheDocument();
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/information/consultations']);
  });

  it('keeps triage data and controls behind triage permission', async () => {
    const request = vi.fn(async (path: string) => {
      if (path !== '/information/consultations') throw new Error(`unexpected path: ${path}`);
      return [consultation];
    });

    const { rerender } = renderRoutePage(
      <TriagePage client={clientFor(request)} user={triageUser} />,
    );

    expect(await screen.findByText('咨询处理队列')).toBeInTheDocument();
    expect(screen.getByText('负责人：triage-1')).toBeInTheDocument();
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/information/consultations']);

    const deniedRequest = vi.fn();
    rerender(
      <MemoryRouter>
        <TriagePage client={clientFor(deniedRequest)} user={student} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('无权处理咨询');
    expect(screen.queryByText('负责人：triage-1')).not.toBeInTheDocument();
    expect(deniedRequest).not.toHaveBeenCalled();
  });
});
