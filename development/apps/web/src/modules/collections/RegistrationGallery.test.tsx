import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RegistrationGallery } from './RegistrationGallery.js';
import type { ApiClient } from '../../core/api/client.js';
function Navigation() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('?focus=native_collection:two&includePast=true')}>
      Another detail
    </button>
  );
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
          fields: [{ id: 'answer', kind: 'short_text', label: '回答', options: [], rules: [] }],
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
});
