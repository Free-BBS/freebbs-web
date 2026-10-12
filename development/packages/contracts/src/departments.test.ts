import { describe, expect, it } from 'vitest';
import * as contracts from './index.js';

describe('canonical department directory', () => {
  it('maps exactly 19 gallery departments and TMS with all exact option roles', () => {
    const directory = (
      contracts as unknown as {
        DEPARTMENT_DIRECTORY: Array<{ id: string; roleKeys: contracts.RoleKey[] }>;
      }
    ).DEPARTMENT_DIRECTORY;
    expect(directory).toHaveLength(20);
    for (const department of directory) {
      const group = contracts.DEVELOPMENT_IDENTITY_GROUPS.find(({ id }) => id === department.id)!;
      expect(department.roleKeys).toEqual(group.options.map(({ roleKey }) => roleKey));
      for (const role of department.roleKeys) {
        expect(contracts.canEditDepartment([role], department.id)).toBe(true);
        expect(contracts.departmentsForRoles([role]).map(({ id }) => id)).toEqual([department.id]);
      }
      expect(contracts.canEditDepartment(['platform.admin'], department.id)).toBe(false);
      expect(contracts.canEditDepartment(['platform.super_admin'], department.id)).toBe(true);
      const unrelated = directory.find(({ id }) => id !== department.id)!;
      expect(contracts.canEditDepartment(unrelated.roleKeys, department.id)).toBe(false);
    }
  });
  it('never assigns broad legacy tuanwei or sast to subdivisions', () => {
    expect(contracts.legacyDepartmentId('tuanwei')).toBeNull();
    expect(contracts.legacyDepartmentId('sast')).toBeNull();
    expect(contracts.legacyDepartmentId('tms')).toBe('tms.position');
    for (const id of [
      'arts_center',
      'sports_center',
      'liaison_center',
      'rights_development_center',
    ] as const) {
      expect(contracts.legacyDepartmentId(id)).toBe(`student_union.${id}`);
    }
    expect(contracts.canEditDepartment(['platform.super_admin'], 'unknown')).toBe(false);
  });
});
