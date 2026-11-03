import {
  DEFAULT_ROOT_ADMIN_UIDS,
  DEPARTMENT_DIRECTORY,
  type FinanceDepartment,
} from '@freebbs-development/contracts';

/** Shared department metadata; personnel authority always comes from the existing identity system. */
export const DEFAULT_FINANCE_DEPARTMENTS: FinanceDepartment[] = [
  ...DEPARTMENT_DIRECTORY.filter(({ id }) => id !== 'tms.position').map(
    ({ id, name, organizationKey }): FinanceDepartment => ({
      id,
      name:
        id === 'youth_league.freshman'
          ? '办公室·新生组'
          : id === 'science_association.training'
            ? '学习培养部'
            : name,
      portId:
        id === 'student_union.sports_center'
          ? 'sports'
          : (organizationKey as FinanceDepartment['portId']),
    }),
  ),
  { id: 'youth_league.tms', name: 'TMS', portId: 'youth_league' },
  { id: 'bbs.platform', name: 'BBS', portId: 'bbs' },
  { id: 'youth_league.common', name: '团委公共预算', portId: 'youth_league' },
  { id: 'student_union.common', name: '学生会公共预算', portId: 'student_union' },
  { id: 'science_association.common', name: '科协公共预算', portId: 'science_association' },
  { id: 'media_center.common', name: '媒体中心公共预算', portId: 'media_center' },
  { id: 'sports.reserve', name: '代表队奖励公共额度', portId: 'sports' },
  {
    id: 'department_common.rooms',
    name: '系用房',
    portId: 'department_common',
    reviewPolicy: { reviewerUids: DEFAULT_ROOT_ADMIN_UIDS.slice(0, 1) },
  },
];
