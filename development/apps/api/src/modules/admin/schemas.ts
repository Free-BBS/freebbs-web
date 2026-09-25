import { MODULE_IDS, ROLE_KEYS } from '@freebbs-development/contracts';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(128);
const scopeTypeSchema = identifier.regex(/^[a-z][a-z0-9_]*$/);
const requiredScopeTypeSchema = scopeTypeSchema.refine((type) => type !== 'public');
const scopeSchema = z
  .object({
    type: scopeTypeSchema,
    id: identifier,
  })
  .strict();
const expiresAt = z.string().datetime({ offset: true }).nullable().optional();

export const paginationQuerySchema = z
  .object({
    query: identifier.optional(),
    status: identifier.optional(),
    scopeType: identifier.optional(),
    scopeId: identifier.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const subjectUidSchema = identifier;

export const modulePatchSchema = z
  .object({
    moduleId: z.enum(MODULE_IDS),
    enabled: z.boolean(),
  })
  .strict();

export const roleAssignmentSchema = z
  .object({
    subjectUid: identifier,
    roleKey: z.enum(ROLE_KEYS),
    expiresAt,
    scope: scopeSchema.optional(),
  })
  .strict();

export const tagKeySchema = identifier.regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/);

export const tagAssignmentSchema = z
  .object({
    subjectUid: identifier,
    tagKey: tagKeySchema,
    expiresAt,
    scope: scopeSchema.optional(),
  })
  .strict();

export const assignmentIdSchema = identifier;
export const roleKeySchema = z.enum(ROLE_KEYS);
export const roleStatusPatchSchema = z.object({ status: z.enum(['active', 'inactive']) }).strict();

export const permissionBindingSchema = z
  .object({
    action: identifier.regex(/^(?:\*|[a-z][a-z0-9_]*(?:\.[a-z0-9_*]+)+)$/),
    resource: identifier.regex(/^(?:\*|[a-z][a-z0-9_]*)$/),
    effect: z.enum(['allow', 'deny']),
    scope: scopeSchema,
  })
  .strict();

export const replacePermissionBindingsSchema = z
  .object({
    bindings: z.array(permissionBindingSchema).max(500),
  })
  .strict()
  .superRefine(({ bindings }, context) => {
    const identities = new Set<string>();
    for (const binding of bindings) {
      const identity = [
        binding.action,
        binding.resource,
        binding.scope.type,
        binding.scope.id,
      ].join('\u0000');
      if (identities.has(identity)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Permission binding tuples must be unique',
          path: ['bindings'],
        });
        return;
      }
      identities.add(identity);
    }
  });

const tagDefinitionFields = {
  key: tagKeySchema,
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(2000),
  requiredScopeType: requiredScopeTypeSchema.nullable(),
  metadata: z.record(z.unknown()),
};

export const createTagDefinitionSchema = z.object(tagDefinitionFields).strict();

export const patchTagDefinitionSchema = z
  .object({
    key: tagDefinitionFields.key.optional(),
    name: tagDefinitionFields.name.optional(),
    description: tagDefinitionFields.description.optional(),
    requiredScopeType: tagDefinitionFields.requiredScopeType.optional(),
    metadata: tagDefinitionFields.metadata.optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required');
