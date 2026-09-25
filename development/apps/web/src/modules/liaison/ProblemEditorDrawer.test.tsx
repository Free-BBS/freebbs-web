import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProblemEditorDrawer } from './ProblemEditorDrawer.js';

async function completeRequiredFields() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('问题标题'), '校园低碳课题');
  await user.type(screen.getByLabelText('简短摘要'), '共同验证低碳原型。');
  await user.type(screen.getByLabelText('背景说明'), '课题组提供公开数据。');
  await user.type(screen.getByLabelText('来源名称'), '校园实验室');
  await user.type(screen.getByLabelText('预期成果'), '可运行原型。');
  await user.type(screen.getByLabelText('公开对接方式'), '联络中心公开咨询台');
  return user;
}

function renderEditor(onSubmit = vi.fn()) {
  render(
    <ProblemEditorDrawer open pending={false} onClose={() => undefined} onSubmit={onSubmit} />,
  );
  return onSubmit;
}

describe('ProblemEditorDrawer validation', () => {
  it('rejects a start time later than the deadline', async () => {
    const onSubmit = renderEditor();
    const user = await completeRequiredFields();
    fireEvent.change(screen.getByLabelText('开始时间（可选）'), {
      target: { value: '2026-10-02T12:00' },
    });
    fireEvent.change(screen.getByLabelText('截止时间（可选）'), {
      target: { value: '2026-10-01T12:00' },
    });
    await user.click(screen.getByRole('button', { name: '保存课题草稿' }));

    expect(screen.getByRole('alert')).toHaveTextContent('开始时间不得晚于截止时间');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects more than twenty tags', async () => {
    const onSubmit = renderEditor();
    const user = await completeRequiredFields();
    await user.type(
      screen.getByLabelText('领域标签（用逗号分隔）'),
      Array.from({ length: 21 }, (_, index) => `标签${index + 1}`).join(','),
    );
    await user.click(screen.getByRole('button', { name: '保存课题草稿' }));

    expect(screen.getByRole('alert')).toHaveTextContent('最多填写 20 个标签');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a tag longer than sixty-four characters', async () => {
    const onSubmit = renderEditor();
    const user = await completeRequiredFields();
    await user.type(screen.getByLabelText('领域标签（用逗号分隔）'), '标'.repeat(65));
    await user.click(screen.getByRole('button', { name: '保存课题草稿' }));

    expect(screen.getByRole('alert')).toHaveTextContent('每个标签最多 64 个字符');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
