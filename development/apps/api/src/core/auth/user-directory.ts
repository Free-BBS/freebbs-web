import type { UserContext } from '@freebbs-development/contracts';

export interface DirectoryUser {
  uid: string;
  username: string;
  displayName: string;
  studentId: string | null;
  avatarUrl: string | null;
}

export interface DirectoryIdentityFilter {
  uids: readonly string[];
  studentIds: readonly string[];
  usernames: readonly string[];
}
export interface DirectoryPageOptions {
  query?: string;
  page: number;
  pageSize: number;
  uids?: readonly string[];
  include?: DirectoryIdentityFilter;
  exclude?: DirectoryIdentityFilter;
}
export interface DirectoryPage {
  items: DirectoryUser[];
  total: number;
  page: number;
  pageSize: number;
}
export interface UserDirectory {
  list(query?: string): Promise<DirectoryUser[]>;
  page?(options: DirectoryPageOptions): Promise<DirectoryPage>;
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

/** Legacy embedded directories remain supported; integrated main-site directories page in SQL. */
export async function directoryPage(
  directory: UserDirectory,
  options: DirectoryPageOptions,
): Promise<DirectoryPage> {
  if (directory.page) return directory.page(options);
  const matches = (user: DirectoryUser, filter: DirectoryIdentityFilter) =>
    filter.uids.includes(user.uid) ||
    Boolean(user.studentId && filter.studentIds.includes(user.studentId)) ||
    filter.usernames.includes(user.username.toLocaleLowerCase());
  const users = (await directory.list(options.query)).filter(
    (user) =>
      (!options.uids || options.uids.includes(user.uid)) &&
      (!options.include || matches(user, options.include)) &&
      (!options.exclude || !matches(user, options.exclude)),
  );
  return {
    items: users.slice((options.page - 1) * options.pageSize, options.page * options.pageSize),
    total: users.length,
    page: options.page,
    pageSize: options.pageSize,
  };
}
