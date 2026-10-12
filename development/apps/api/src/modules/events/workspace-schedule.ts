import { resolve } from 'node:path';
import type { ActivityRecord } from '../../core/database/types.js';
import { readActivityWorkspace } from './workspace-storage.js';

// Workspace schedules are persisted once. Legacy APIs read the same override,
// while source workflow state and registration deadlines remain independent.
export async function activityWithWorkspaceSchedule(
  activity: ActivityRecord,
  directory = resolve('.data/collection-uploads'),
): Promise<ActivityRecord> {
  const { schedule } = await readActivityWorkspace(directory, 'development_activity', activity.id);
  if (!schedule) return activity;
  return {
    ...activity,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    status: activity.status === 'published' && schedule.finished ? 'finished' : activity.status,
  };
}
