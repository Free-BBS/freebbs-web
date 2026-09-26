import { describe, expect, it } from 'vitest';
import { emptyCollectionSchema } from '../collection-utils.js';
import {
  acceptsRule,
  addField,
  attachRule,
  moveField,
  removeField,
  validateSchema,
} from './model.js';

describe('collection builder model', () => {
  it('adds and reorders stable field blocks', () => {
    const withText = addField(emptyCollectionSchema, 'short_text');
    const textId = withText.fields[1]?.id;
    expect(textId).toBeTruthy();
    const moved = moveField(withText, textId as string, 0);
    expect(moved.fields[0]?.id).toBe(textId);
    expect(removeField(moved, textId as string).fields).toHaveLength(1);
  });

  it('only snaps compatible rule parts into a slot', () => {
    expect(acceptsRule('form', 'audience')).toBe(true);
    expect(acceptsRule('form', 'file_size')).toBe(false);
    expect(acceptsRule('video', 'file_size')).toBe(true);
    expect(acceptsRule('short_text', 'file_size')).toBe(false);
    const fieldId = emptyCollectionSchema.fields[0]?.id as string;
    const unchanged = attachRule(emptyCollectionSchema, 'file_size', fieldId);
    expect(unchanged).toEqual(emptyCollectionSchema);
  });

  it('rejects duplicate singleton rules and reports invalid forms', () => {
    const once = attachRule(emptyCollectionSchema, 'capacity');
    expect(attachRule(once, 'capacity')).toEqual(once);
    expect(validateSchema({ ...once, title: '', fields: [] })).toEqual([
      '请填写表单名称',
      '至少添加一个展示模块',
    ]);
  });
});
