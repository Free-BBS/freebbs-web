import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InspectorPanel } from './InspectorPanel.js';
import { emptyCollectionSchema } from '../collection-utils.js';
it('edits opening and closing schedule boundaries as valid ISO timestamps', () => {
  const change = vi.fn();
  render(
    <InspectorPanel
      schema={{
        ...emptyCollectionSchema,
        formRules: [{ id: 'schedule', kind: 'schedule', value: { start: '', end: '' } }],
      }}
      selection={{ type: 'rule', id: 'schedule' }}
      onSchemaChange={vi.fn()}
      onFieldChange={vi.fn()}
      onRuleChange={change}
      onDeleteField={vi.fn()}
      onDeleteRule={vi.fn()}
      onOutputChange={vi.fn()}
      onDeleteOutput={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('开放时间'), { target: { value: '2026-10-12T09:00' } });
  expect(change).toHaveBeenCalledWith(
    {
      id: 'schedule',
      kind: 'schedule',
      value: { start: new Date('2026-10-12T09:00').toISOString(), end: '' },
    },
    undefined,
  );
});
