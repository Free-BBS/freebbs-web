import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TeamShowcase } from './TeamShowcase.js';

describe('TeamShowcase', () => {
  it('presents a structured editor and image dropzone to a captain', async () => {
    const user = userEvent.setup();
    const request = vi.fn().mockResolvedValue(null);
    render(<TeamShowcase client={{ request }} teamId="team-a" canEdit />);
    await user.click(await screen.findByRole('button', { name: '编辑风采' }));
    expect(screen.getByRole('toolbar', { name: '图文排版工具' })).toBeInTheDocument();
    expect(screen.getByLabelText('上传代表队风采图片')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '实时预览' })).toBeInTheDocument();
  });
});
