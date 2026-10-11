import {
  SOCIAL_ORGANIZATION_IDS,
  departmentById,
  type DepartmentId,
} from '@freebbs-development/contracts';
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
  .strict()
  .superRefine((rule, context) => {
    const invalid = () =>
      context.addIssue({ code: z.ZodIssueCode.custom, message: '规则值无效', path: ['value'] });
    if (
      ['capacity', 'attempt_limit', 'upload_count', 'file_size'].includes(rule.kind) &&
      (typeof rule.value !== 'number' || !Number.isSafeInteger(rule.value) || rule.value < 1)
    )
      invalid();
    if (rule.kind === 'required' && typeof rule.value !== 'boolean') invalid();
    if (rule.kind === 'file_types' && !Array.isArray(rule.value)) invalid();
    if (
      rule.kind === 'audience' &&
      !(typeof rule.value === 'string' || rule.value === true || Array.isArray(rule.value))
    )
      invalid();
    if (rule.kind === 'schedule') {
      if (
        !rule.value ||
        typeof rule.value !== 'object' ||
        Array.isArray(rule.value) ||
        'mode' in rule.value
      ) {
        invalid();
        return;
      }
      const boundaries = [rule.value.start, rule.value.end].filter((value): value is string =>
        Boolean(value),
      );
      if (
        boundaries.some((value) => !z.string().datetime({ offset: true }).safeParse(value).success)
      )
        invalid();
      if (
        rule.value.start &&
        rule.value.end &&
        Date.parse(rule.value.start) >= Date.parse(rule.value.end)
      )
        invalid();
    }
  });

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
    publicRegistration: z.boolean().optional(),
    recipientMode: z.enum(['open', 'named', 'restricted']).optional(),
    publisherDepartmentId: z
      .string()
      .refine((id) => departmentById(id) !== undefined)
      .transform((id) => id as DepartmentId)
      .optional(),
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
  .strict()
  .superRefine((schema, context) => {
    const unique = (values: string[], path: (string | number)[]) => {
      if (new Set(values).size !== values.length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: '模块或规则重复', path });
    };
    unique(
      schema.fields.map((field) => field.id),
      ['fields'],
    );
    unique(
      schema.outputs.map((output) => output.id),
      ['outputs'],
    );
    unique(
      schema.formRules.map((rule) => rule.kind),
      ['formRules'],
    );
    schema.fields.forEach((field, index) =>
      unique(
        field.rules.map((rule) => rule.kind),
        ['fields', index, 'rules'],
      ),
    );
  });

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
