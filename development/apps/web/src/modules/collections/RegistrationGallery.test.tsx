import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RegistrationGallery } from './RegistrationGallery.js';
import type { UnifiedRegistration } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';
function Navigation() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('?focus=native_collection:two&includePast=true')}>
      Another detail
    </button>
  );
}

function attachmentRegistration(): UnifiedRegistration {
  return {
    id: 'attachments',
    source: 'native_collection',
    title: '附件重复提交',
    description: '',
    organizer: '社工',
    coverUrl: null,
    opensAt: null,
    closesAt: null,
    location: null,
    capacity: null,
    registrationCount: 0,
    status: 'open',
    registered: false,
    attemptsUsed: 0,
    attemptLimit: 3,
    schema: {
      title: '附件重复提交',
      description: '',
      fields: [
        { id: 'answer', kind: 'short_text', label: '回答', helpText: '', options: [], rules: [] },
        { id: 'file', kind: 'file', label: '可选附件', helpText: '', options: [], rules: [] },
      ],
      formRules: [],
      outputs: [],
    },
  };
}

describe('associated registration deep links', () => {
  it('opens learning registration in place without an external survey link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url === '/api/surveys'
                ? {
                    surveys: [
                      {
                        id: 'guest',
                        title: '免登录活动',
                        opensAt: '2020-01-01',
                        closesAt: '2099-01-01',
                      },
                    ],
                    nextPage: null,
                  }
                : {
                    survey: {
                      id: 'guest',
                      title: '免登录活动',
                      questions: [{ id: 'q1', label: '你的回答', type: 'text', required: false }],
                      opensAt: '2020-01-01',
                      closesAt: '2099-01-01',
                    },
                  },
            ),
          ),
      ),
    );
    render(
      <MemoryRouter>
        <RegistrationGallery client={{ request: vi.fn(async () => []) as ApiClient['request'] }} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /免登录活动/ }));
    await screen.findByLabelText('你的回答');
    expect(screen.queryByRole('link', { name: /前往学习端/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
  it('loads history, focuses details, disables past answers/submissions, and updates same-route focus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('unavailable');
      }),
    );
    const request = vi.fn(async () =>
      ['one', 'two'].map((id) => ({
        id,
        source: 'native_collection',
        title: `过去活动${id}`,
        description: '历史说明',
        organizer: '体育中心',
        status: 'closed',
        closesAt: null,
        schema: {
          fields: [
            {
              id: 'answer',
              kind: 'short_text',
              label: '回答',
              helpText: '',
              options: [],
              rules: [],
            },
          ],
        },
      })),
    );
    render(
      <MemoryRouter
        initialEntries={['/collections/registrations?focus=native_collection:one&includePast=true']}
      >
        <Navigation />
        <RegistrationGallery client={{ request: request as ApiClient['request'] }} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: /过去活动one/ });
    expect(request).toHaveBeenCalledWith('/collections/registrations?includePast=true');
    expect(screen.getByRole('button', { name: '报名已截止' })).toBeDisabled();
    expect(screen.getByLabelText('回答')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Another detail' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /过去活动two/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      ),
    );
    vi.unstubAllGlobals();
  });
  it('allows remaining native attempts and disables only after the final submission', async () => {
    const item: UnifiedRegistration & { attemptsUsed: number; attemptLimit: number } = {
      id: 'repeat',
      source: 'native_collection',
      title: '重复提交表单',
      description: '',
      organizer: '社工',
      coverUrl: null,
      opensAt: null,
      closesAt: null,
      location: null,
      capacity: null,
      registrationCount: 1,
      status: 'open',
      registered: true,
      attemptsUsed: 1,
      attemptLimit: 3,
      schema: {
        title: '重复提交表单',
        description: '',
        fields: [
          { id: 'answer', kind: 'short_text', label: '回答', helpText: '', options: [], rules: [] },
        ],
        formRules: [],
        outputs: [],
      },
    };
    const request = vi.fn(async () => ({}));
    render(
      <MemoryRouter>
        <RegistrationGallery
          focusedItem={item}
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    );
    const answer = await screen.findByLabelText('回答');
    expect(answer).toBeEnabled();
    expect(screen.getByText('已提交 1 / 3 次')).toBeInTheDocument();
    fireEvent.change(answer, { target: { value: '第二次回答' } });
    fireEvent.click(screen.getByRole('button', { name: '再次提交' }));
    await screen.findByText('已提交 2 / 3 次');
    expect(screen.getByRole('button', { name: '再次提交' })).toBeEnabled();
    fireEvent.change(answer, { target: { value: '第三次回答' } });
    fireEvent.click(screen.getByRole('button', { name: '再次提交' }));
    await screen.findByText('已提交 3 / 3 次');
    expect(screen.getByRole('button', { name: '已达提交上限' })).toBeDisabled();
    expect(answer).toBeDisabled();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('uploads the same optional file again after a successful submission', async () => {
    const user = userEvent.setup();
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(async (path) =>
      path === '/collections/assets' ? { id: 'uploaded-file' } : {},
    );
    render(
      <MemoryRouter>
        <RegistrationGallery
          focusedItem={attachmentRegistration()}
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    );
    const file = new File(['same content'], 'same-file.txt', { type: 'text/plain' });
    await user.upload(await screen.findByLabelText('可选附件'), file);
    fireEvent.change(screen.getByLabelText('回答'), { target: { value: '第一次回答' } });
    await user.click(screen.getByRole('button', { name: '确认报名' }));
    await screen.findByText('已提交 1 / 3 次');

    await user.upload(screen.getByLabelText('可选附件'), file);
    fireEvent.change(screen.getByLabelText('回答'), { target: { value: '第二次回答' } });
    await user.click(screen.getByRole('button', { name: '再次提交' }));
    await screen.findByText('已提交 2 / 3 次');

    const uploads = request.mock.calls.filter(([path]) => path === '/collections/assets');
    expect(uploads).toHaveLength(2);
    for (const [, init] of uploads) {
      expect((init?.body as FormData).get('file')).toBe(file);
    }
    const responses = request.mock.calls.filter(([path]) => path.endsWith('/responses'));
    expect(responses.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { answers: { answer: '第一次回答', file: { id: 'uploaded-file' } } },
      { answers: { answer: '第二次回答', file: { id: 'uploaded-file' } } },
    ]);
    expect((screen.getByLabelText('可选附件') as HTMLInputElement).files).toHaveLength(0);
  });

  it('preserves selected files and answers while pending and after a failed submission', async () => {
    const user = userEvent.setup();
    let rejectResponse!: (error: Error) => void;
    const pendingResponse = new Promise<never>((_resolve, reject) => {
      rejectResponse = reject;
    });
    let failed = false;
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(async (path) => {
      if (path === '/collections/assets') return { id: 'uploaded-file' };
      if (!failed) return pendingResponse;
      return {};
    });
    render(
      <MemoryRouter>
        <RegistrationGallery
          focusedItem={attachmentRegistration()}
          client={{ request: request as ApiClient['request'] }}
        />
      </MemoryRouter>,
    );
    const attachment = (await screen.findByLabelText('可选附件')) as HTMLInputElement;
    const file = new File(['draft content'], 'draft.txt', { type: 'text/plain' });
    await user.upload(attachment, file);
    fireEvent.change(screen.getByLabelText('回答'), { target: { value: '未提交的回答' } });
    await user.click(screen.getByRole('button', { name: '确认报名' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: '正在提交…' })).toBeDisabled();
    expect(screen.getByLabelText('可选附件')).toBe(attachment);
    expect(attachment.files?.[0]).toBe(file);
    expect(screen.getByLabelText('回答')).toHaveValue('未提交的回答');

    failed = true;
    rejectResponse(new Error('response failed'));
    await screen.findByText('提交失败，请稍后重试。');
    expect(screen.getByLabelText('可选附件')).toBe(attachment);
    expect(attachment.files?.[0]).toBe(file);
    expect(screen.getByLabelText('回答')).toHaveValue('未提交的回答');
    expect(screen.getByText('已提交 0 / 3 次')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认报名' }));
    await screen.findByText('已提交 1 / 3 次');
    expect(request.mock.calls.filter(([path]) => path === '/collections/assets')).toHaveLength(2);
    const responses = request.mock.calls.filter(([path]) => path.endsWith('/responses'));
    expect(JSON.parse(String(responses[1]?.[1]?.body))).toEqual({
      answers: { answer: '未提交的回答', file: { id: 'uploaded-file' } },
    });
    expect((screen.getByLabelText('可选附件') as HTMLInputElement).files).toHaveLength(0);
    expect(screen.getByLabelText('回答')).toHaveValue('');
  });

  it.each(['native_collection', 'development_activity'] as const)(
    'keeps registered legacy %s entries disabled without attempt metadata',
    async (source) => {
      const item: UnifiedRegistration = {
        id: 'legacy',
        source,
        title: '已有报名',
        description: '',
        organizer: '社工',
        coverUrl: null,
        opensAt: null,
        closesAt: null,
        location: null,
        capacity: null,
        registrationCount: 1,
        status: 'open',
        registered: true,
      };
      render(
        <MemoryRouter>
          <RegistrationGallery
            focusedItem={item}
            client={{ request: vi.fn() as ApiClient['request'] }}
          />
        </MemoryRouter>,
      );
      expect(await screen.findByRole('button', { name: '已报名' })).toBeDisabled();
    },
  );
});
