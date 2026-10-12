import { expect, it } from 'vitest';
import { collectionTemplates, instantiateTemplate } from './templates.js';
import { validateSchema } from './model.js';
it('provides reusable valid media, material and schedule templates with fresh field identifiers', () => {
  expect(collectionTemplates.map((item) => item.id)).toEqual(
    expect.arrayContaining(['video', 'audio', 'material', 'timesurvey']),
  );
  for (const template of collectionTemplates) {
    const first = instantiateTemplate(template.schema),
      second = instantiateTemplate(template.schema);
    expect(validateSchema(first)).toEqual([]);
    expect(first.fields[0]?.id).not.toBe(second.fields[0]?.id);
  }
  expect(
    collectionTemplates
      .find((item) => item.id === 'video')
      ?.schema.fields.some((field) => field.kind === 'image' && field.label === '封面'),
  ).toBe(true);
});
