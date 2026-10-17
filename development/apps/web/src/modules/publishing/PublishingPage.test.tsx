import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { PublishingPage } from './PublishingPage.js';
import type { RoleKey } from '@freebbs-development/contracts';
const { request, client } = vi.hoisted(() => {
  const request = vi.fn();
  return { request, client: { request } };
});
const actor = vi.hoisted(() => ({ roles: ['department.rights_development_member'] as RoleKey[] }));
vi.mock('../../core/auth/AuthProvider.js', () => ({
  useAuth: () => ({ client, user: { roles: actor.roles } }),
}));
beforeEach(() => {
  request.mockReset();
  actor.roles = ['department.rights_development_member'];
});
describe('publishing catalog', () => {
  it('ignores a foreign department supplied in a new-content link', async () => {
    request.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('保存被测试服务拒绝');
      return { canCreate: true, items: [] };
    });
    render(
      <MemoryRouter initialEntries={['/?create=1&department=student_union.sports_center']}>
        <PublishingPage />
      </MemoryRouter>,
    );
    const department = await screen.findByLabelText('所属部门');
    expect(department).toHaveValue('');
    await userEvent.type(screen.getByLabelText('标题'), '新内容');
    await userEvent.click(screen.getByRole('button', { name: '保存内容' }));
    await waitFor(() =>
      expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const write = request.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(write?.[1]?.body)).departmentId).toBeNull();
  });
  it.each(['counselor.youth_league_secretary', 'counselor.youth_league'] as const)(
    'offers all departments to global supervisor %s',
    async (role) => {
      actor.roles = [role];
      request.mockResolvedValue({ canCreate: true, items: [] });
      render(
        <MemoryRouter initialEntries={['/?create=1']}>
          <PublishingPage />
        </MemoryRouter>,
      );
      expect((await screen.findByLabelText('所属部门')).querySelectorAll('option')).toHaveLength(
        21,
      );
    },
  );
  it('searches book authors, recommendations and weekly schedule entries', async () => {
    request.mockResolvedValue({
      canCreate: false,
      items: [
        {
          id: 'book',
          category: 'book_share',
          title: '校园好书',
          text: '',
          tags: [],
          course: '',
          year: '',
          author: '张三',
          recommendation: '适合初学者',
          schedule: [],
          links: [],
          status: 'published',
          likeCount: 0,
        },
        {
          id: 'week',
          category: 'schedules',
          title: '本周安排',
          text: '',
          tags: [],
          course: '',
          year: '',
          schedule: [{ date: '2026-10-10', title: '秋日例会', url: '' }],
          links: [],
          status: 'published',
          likeCount: 0,
        },
      ],
    });
    render(
      <MemoryRouter>
        <PublishingPage />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '校园好书' });
    const search = screen.getByRole('textbox', { name: '搜索内容' });
    await userEvent.type(search, '张三');
    expect(screen.getByRole('heading', { name: '校园好书' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '本周安排' })).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, '秋日例会');
    expect(screen.getByRole('heading', { name: '本周安排' })).toBeInTheDocument();
  });
  it('updates category and editor when navigation changes and excludes unavailable categories', async () => {
    request.mockResolvedValue({
      canCreate: true,
      availableCategories: ['book_share', 'work_experience'],
      items: [],
    });
    const router = createMemoryRouter(
      [{ path: '/', element: <PublishingPage book="experience" /> }],
      { initialEntries: ['/?category=book_share'] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole('button', { name: '＋ 创建内容' });
    expect(screen.getByRole('combobox', { name: '分类' })).toHaveValue('book_share');
    await router.navigate('/?category=work_experience&create=1');
    await screen.findByRole('heading', { name: '创建草稿' });
    expect(
      screen
        .getAllByRole('combobox', { name: '分类' })
        .every((element) => (element as HTMLSelectElement).value === 'work_experience'),
    ).toBe(true);
    expect(screen.queryByRole('option', { name: '活动文章' })).toBeNull();
  });
  it('shows read-only catalog to ordinary readers and filters text', async () => {
    request.mockResolvedValue({
      canCreate: false,
      items: [
        {
          id: '1',
          category: 'course_experience',
          title: '线性代数经验',
          text: '整理笔记',
          tags: ['学习'],
          course: '数学',
          year: '2026',
          status: 'published',
          likeCount: 2,
        },
        {
          id: '2',
          category: 'work_experience',
          title: '活动筹备',
          text: '流程安排',
          tags: [],
          course: '',
          year: '',
          status: 'published',
          likeCount: 0,
        },
      ],
    });
    render(
      <MemoryRouter>
        <PublishingPage book="experience" />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '线性代数经验' });
    expect(screen.queryByRole('button', { name: '＋ 创建内容' })).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: '搜索内容' }), '数学');
    expect(screen.queryByRole('heading', { name: '活动筹备' })).toBeNull();
  });
  it('creates draft with safely serialized plain text', async () => {
    request.mockResolvedValueOnce({ canCreate: true, items: [] }).mockResolvedValueOnce({
      id: 'new',
      category: 'article',
      title: '新故事',
      text: '<script>文字</script>',
      tags: [],
      course: '',
      year: '',
      author: '',
      recommendation: '',
      images: [],
      links: [],
      schedule: [],
      status: 'draft',
      audience: 'all',
      canManage: true,
      revision: 1,
    });
    render(
      <MemoryRouter>
        <PublishingPage />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: '＋ 创建内容' }));
    await userEvent.type(screen.getByRole('textbox', { name: '标题' }), '新故事');
    await userEvent.type(screen.getByRole('textbox', { name: '正文' }), '<script>文字</script>');
    await userEvent.click(screen.getByRole('button', { name: '保存内容' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const options = request.mock.calls[1]?.[1];
    expect(JSON.parse(options.body)).toMatchObject({
      status: 'draft',
      text: '<script>文字</script>',
    });
    expect(document.querySelector('script')).toBeNull();
  });
});
