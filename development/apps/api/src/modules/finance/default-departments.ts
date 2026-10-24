import { DEPARTMENT_DIRECTORY, type FinanceDepartment } from '@freebbs-development/contracts';

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
];
