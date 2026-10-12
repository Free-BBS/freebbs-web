import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningSurveyRegistration } from './LearningSurveyRegistration.js';

const survey = {
  id: 'survey-1',
  title: '体验报名',
  description: '请填写',
  status: 'open',
  opensAt: '2020-01-01',
  closesAt: '2099-01-01',
  requiresLogin: false,
  questions: [
    { id: 'q1', label: '姓名', type: 'text', required: true, options: [] },
    { id: 'q2', label: '介绍', type: 'textarea', required: false, options: [] },
    { id: 'q3', label: '场次', type: 'single', required: true, options: ['上午', '下午'] },
    { id: 'q4', label: '兴趣', type: 'multiple', required: true, options: ['摄影', '音乐'] },
  ],
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});
function fill() {
  fireEvent.change(screen.getByLabelText(/联系邮箱/), { target: { value: 'guest@example.com' } });
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Guest' } });
  fireEvent.change(screen.getByLabelText('介绍'), { target: { value: 'Draft' } });
  fireEvent.click(screen.getByLabelText('上午'));
  fireEvent.click(screen.getByLabelText('摄影'));
}

describe('inline learning survey registration', () => {
  it('retries schema loading and keeps upcoming activities closed to submissions', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('暂时离线'))
      .mockResolvedValueOnce(response({ survey: { ...survey, opensAt: '2098-01-01' } }));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByText('暂时离线');
    fireEvent.click(screen.getByRole('button', { name: '重新加载报名表' }));
    await screen.findByText('报名尚未开放');
    expect(screen.queryByRole('button', { name: '提交报名' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查询抽签结果' })).toBeEnabled();
  });

  it('reuses a learning receipt saved before a failed submit and preserves other surveys', async () => {
    sessionStorage.setItem(
      'freebbs_activity_receipts_v2',
      JSON.stringify({
        owner: 'anonymous',
        receipts: { 'survey-1': 'b'.repeat(64), other: 'c'.repeat(64) },
      }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ survey }))
      .mockResolvedValueOnce(response({ message: '未找到此报名回执' }, 404))
      .mockResolvedValueOnce(response({}));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByLabelText('姓名');
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    fill();
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    await screen.findByText('报名成功，感谢参与！');
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)).receipt).toBe('b'.repeat(64));
    expect(
      JSON.parse(sessionStorage.getItem('freebbs_activity_receipts_v2') || '{}').receipts.other,
    ).toBe('c'.repeat(64));
  });

  it('keeps an unconfirmed saved receipt retryable when result data is malformed', async () => {
    sessionStorage.setItem(
      'freebbs_activity_receipts_v2',
      JSON.stringify({ owner: 'anonymous', receipts: { 'survey-1': 'b'.repeat(64) } }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ survey }))
      .mockResolvedValueOnce(response({ unexpected: true }));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByLabelText('姓名');
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('报名成功，感谢参与！')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交报名' })).toBeEnabled();
  });

  it('explains copy failure when the browser clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    sessionStorage.setItem(
      'freebbs_activity_receipts_v2',
      JSON.stringify({ owner: 'anonymous', receipts: { 'survey-1': 'b'.repeat(64) } }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ survey }))
      .mockResolvedValueOnce(response({ result: 'pending' }));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByRole('button', { name: '复制回执' });
    fireEvent.click(screen.getByRole('button', { name: '复制回执' }));
    await screen.findByText('复制失败，请手动复制或下载回执。');
  });

  it('submits all question kinds anonymously and retains receipt/draft across a lost-response retry', async () => {
    let storedBeforeSubmit = false;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ survey }))
      .mockImplementationOnce(async () => {
        storedBeforeSubmit = !!sessionStorage.getItem('freebbs_activity_receipts_v2');
        throw new Error('网络中断');
      })
      .mockResolvedValueOnce(response({ receipt: 'ignored' }));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByLabelText('姓名');
    fill();
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    await screen.findByText(/网络中断/);
    expect(storedBeforeSubmit).toBe(true);
    expect(screen.getByLabelText('介绍')).toHaveValue('Draft');
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    await screen.findByText('报名成功，感谢参与！');
    const first = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const retry = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    expect(first.receipt).toMatch(/^[a-f0-9]{64}$/);
    expect(retry).toEqual(first);
    expect(first.answers).toEqual({ q1: 'Guest', q2: 'Draft', q3: '上午', q4: ['摄影'] });
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).has('Authorization')).toBe(false);
    expect(screen.getByRole('button', { name: '下载报名回执' })).toBeEnabled();
  });

  it('validates required multiple choices before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({ survey }));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByLabelText('姓名');
    fill();
    fireEvent.click(screen.getByLabelText('摄影'));
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    await screen.findByText('请填写：兴趣');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires login only when requested and includes the existing bearer token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ survey: { ...survey, requiresLogin: true } }))
      .mockResolvedValue(response({}));
    const view = render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByText('本活动需要登录后报名');
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
    localStorage.setItem('free_bbs_auth_token', 'private-token');
    view.unmount();
    fetcher
      .mockReset()
      .mockResolvedValueOnce(response({ survey: { ...survey, requiresLogin: true } }))
      .mockResolvedValue(response({}));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByLabelText('姓名');
    fill();
    fireEvent.click(screen.getByRole('button', { name: '提交报名' }));
    await screen.findByText('报名成功，感谢参与！');
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer private-token',
    );
  });

  it('looks up a user-entered receipt using POST even after registration closed', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ survey: { ...survey, status: 'drawn' } }))
      .mockResolvedValueOnce(response({ result: 'won', drawnAt: '2026-01-01' }));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByText('报名已截止');
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('报名回执'), { target: { value: 'a'.repeat(64) } });
    fireEvent.click(screen.getByRole('button', { name: '查询抽签结果' }));
    await screen.findByText(/你已中签/);
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/surveys/survey-1/result');
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      receipt: 'a'.repeat(64),
    });
  });

  it('clears private answers and receipts when browser identity changes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({ survey }));
    render(<LearningSurveyRegistration surveyId="survey-1" fetcher={fetcher} />);
    await screen.findByLabelText('姓名');
    fill();
    localStorage.setItem('free_bbs_auth_token', 'new-identity');
    fireEvent(window, new Event('freebbs:session-change'));
    await waitFor(() => expect(screen.getByLabelText('姓名')).toHaveValue(''));
    expect(screen.getByLabelText('报名回执')).toHaveValue('');
  });
});
