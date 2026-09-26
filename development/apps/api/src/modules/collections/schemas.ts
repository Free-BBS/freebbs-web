import { SOCIAL_ORGANIZATION_IDS } from '@freebbs-development/contracts';
import { z } from 'zod';

const id = z.string().trim().min(1).max(128);
const dateTime = z.string().datetime({ offset: true }).nullable();
const ruleValue = z.union([
  z.string().max(500),
  z.number().nonnegative(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.object({ start: z.string().optional(), end: z.string().optional() }).strict(),
  z
    .object({
      mode: z.literal('title_validation'),
      minLength: z.number().int().min(0).max(500),
      maxLength: z.number().int().min(1).max(500),
      forbiddenCharacters: z.string().max(200),
      forbiddenWords: z.array(z.string().trim().min(1).max(100)).max(100),
      allowLineBreaks: z.boolean(),
      trimWhitespace: z.boolean(),
    })
    .strict(),
]);

export const collectionRuleSchema = z
  .object({
    id,
    kind: z.enum([
      'audience',
      'required',
      'attempt_limit',
      'upload_count',
      'file_types',
      'file_size',
      'title_pattern',
      'schedule',
      'capacity',
    ]),
    value: ruleValue,
  })
  .strict();

export const collectionFieldSchema = z
  .object({
    id,
    kind: z.enum([
      'instructions',
      'identity',
      'short_text',
      'long_text',
      'single_choice',
      'multiple_choice',
      'datetime',
      'file',
      'image',
      'video',
      'audio',
    ]),
    label: z.string().trim().min(1).max(200),
    helpText: z.string().trim().max(500),
    options: z.array(z.string().trim().min(1).max(200)).max(100),
    rules: z.array(collectionRuleSchema).max(20),
  })
  .strict();

export const collectionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5_000),
    fields: z.array(collectionFieldSchema).min(1).max(100),
    formRules: z.array(collectionRuleSchema).max(20),
    outputs: z
      .array(
        z
          .object({
            id,
            kind: z.enum(['excel', 'csv', 'json', 'summary']),
            label: z.string().trim().min(1).max(100),
            fileName: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict();

export const formCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5_000).default(''),
    coverUrl: z.string().url().max(1_024).nullable().default(null),
    organizationId: z.enum(SOCIAL_ORGANIZATION_IDS).nullable().default(null),
    opensAt: dateTime.default(null),
    closesAt: dateTime.default(null),
    capacity: z.number().int().positive().max(100_000).nullable().default(null),
    schema: collectionSchema,
  })
  .strict();

export const formDraftSchema = formCreateSchema.partial().extend({ schema: collectionSchema });
export const responseSchema = z
  .object({ answers: z.record(z.string().max(128), z.unknown()) })
  .strict();
export const formRouteSchema = z.object({ formId: id }).strict();
export const articleRouteSchema = z.object({ articleId: id }).strict();
export const moduleDefinitionCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    description: z.string().trim().max(500).default(''),
    defaultLabel: z.string().trim().min(1).max(200),
    fieldKind: collectionFieldSchema.shape.kind,
  })
  .strict();
