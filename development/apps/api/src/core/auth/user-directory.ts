import type { UserContext } from '@freebbs-development/contracts';

export interface DirectoryUser {
  uid: string;
  username: string;
  displayName: string;
  studentId: string | null;
  avatarUrl: string | null;
}

export interface UserDirectory {
  list(query?: string): Promise<DirectoryUser[]>;
  get(uid: string): Promise<DirectoryUser | null>;
}

export function directoryUserContext(user: DirectoryUser): UserContext {
  return {
    uid: user.uid,
    username: user.username,
    studentId: user.studentId,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    baseRole: 'student',
    roles: [],
    tags: [],
  };
}
