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
  it('accepts protected dragover data and validates the payload only on drop', () => {
    const onAttachRule = vi.fn();
    render(
      <FormCanvas
        schema={schema}
        selection={{ type: 'form' }}
        onSelect={vi.fn()}
        onAddField={vi.fn()}
        onMoveField={vi.fn()}
        onAttachRule={onAttachRule}
        armedRule={null}
      />,
    );
    const slot = screen.getByRole('button', { name: /附加规则卡槽/ });
    expect(
      fireEvent.dragOver(slot, { dataTransfer: { types: ['text/plain'], getData: () => '' } }),
    ).toBe(false);
    fireEvent.drop(slot, { dataTransfer: { getData: () => 'rule:schedule' } });
    expect(onAttachRule).toHaveBeenCalledWith('schedule');
    fireEvent.drop(slot, { dataTransfer: { getData: () => 'rule:required' } });
    fireEvent.drop(slot, { dataTransfer: { getData: () => 'rule:audience' } });
    expect(onAttachRule).toHaveBeenCalledTimes(1);
  });
});
