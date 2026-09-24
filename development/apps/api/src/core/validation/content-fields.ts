import { z } from 'zod';
import { encodeUtcDateTime } from '../database/date-codec.js';

export const nullableContentDateTime = z
  .string()
  .datetime({ offset: true })
  .refine((value) => {
    try {
      encodeUtcDateTime(value);
      return true;
    } catch {
      return false;
    }
  })
  .nullable();
export const contentCategory = z.string().trim().min(1).max(80);
export const knowledgeReadabilitySchema = z.object({
  category: contentCategory.default('general'),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  summary: z.string().trim().max(500).default(''),
  maintainedAt: nullableContentDateTime.default(null),
  maintainerUid: z.string().trim().min(1).max(128).nullable().default(null),
});
export const clubReadabilitySchema = z.object({
  category: contentCategory.default('general'),
  contactName: z.string().trim().max(128).default(''),
  publicContact: z.string().trim().max(500).default(''),
});
export const activityReadabilitySchema = z.object({
  registrationDeadline: nullableContentDateTime.default(null),
  capacity: z.number().int().positive().max(2147483647).nullable().default(null),
  contact: z.string().trim().max(500).default(''),
});
export const teamReadabilitySchema = z.object({
  season: z.string().trim().max(80).default(''),
  trainingSchedule: z.string().trim().max(500).default(''),
});
