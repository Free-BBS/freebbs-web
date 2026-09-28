import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CollectionSchema } from '@freebbs-development/contracts';
import { FormCanvas } from './FormCanvas.js';

const schema: CollectionSchema = {
  title: '活动报名',
  description: '填写报名信息',
  fields: [],
  formRules: [{ id: 'audience-rule', kind: 'audience', value: ['all'] }],
  outputs: [],
};

describe('FormCanvas', () => {
  it('selects an attached form-level rule for editing', () => {
    const onSelect = vi.fn();
    render(
      <FormCanvas
        schema={schema}
        selection={{ type: 'form' }}
        onSelect={onSelect}
        onAddField={vi.fn()}
        onMoveField={vi.fn()}
        onAttachRule={vi.fn()}
        armedRule={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑附加规则：可见范围' }));

    expect(onSelect).toHaveBeenCalledWith({ type: 'rule', id: 'audience-rule' });
  });
});
