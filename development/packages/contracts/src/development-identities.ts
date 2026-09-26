import type { RoleKey } from './modules.js';

export interface DevelopmentIdentityOption {
  roleKey: RoleKey;
  label: string;
}

export interface DevelopmentIdentityGroup {
  id: string;
  label: string;
  selection: 'single' | 'toggle';
  options: readonly DevelopmentIdentityOption[];
}

export interface DevelopmentIdentitySection {
  id:
    | 'counselors'
    | 'student_union'
    | 'youth_league'
    | 'tms'
    | 'science_association'
    | 'media_center';
  label: string;
  groups: readonly DevelopmentIdentityGroup[];
}

const option = (roleKey: RoleKey, label: string): DevelopmentIdentityOption => ({ roleKey, label });

const threeLevelGroup = (
  id: string,
  label: string,
  prefix: string,
  labels: readonly [string, string, string],
  suffixes: readonly [string, string, string],
): DevelopmentIdentityGroup => ({
  id,
  label,
  selection: 'single',
  options: suffixes.map((suffix, index) =>
    option(`${prefix}.${suffix}` as RoleKey, labels[index]!),
  ),
});

export const DEVELOPMENT_IDENTITY_SECTIONS: readonly DevelopmentIdentitySection[] = [
  {
    id: 'counselors',
    label: '辅导员',
    groups: [
      {
        id: 'counselors.position',
        label: '辅导员身份',
        selection: 'single',
        options: [
          option('counselor.youth_league_secretary', '团委书记'),
          option('counselor.youth_league', '团委辅导员'),
          option('counselor.practice', '实践辅导员'),
          option('counselor.innovation', '科创辅导员'),
          option('counselor.student_development', '学生发展辅导员'),
        ],
      },
    ],
  },
  {
    id: 'student_union',
    label: '电子系学生会',
    groups: [
      {
        id: 'student_union.executive',
        label: '主席层',
        selection: 'single',
        options: [
          option('student_union.executive_president', '执行主席'),
          option('student_union.presidium', '主席团'),
        ],
      },
      {
        id: 'student_union.arts_center',
        label: '文艺中心',
        selection: 'single',
        options: [
          option('domain.arts_lead', '负责人'),
          option('department.arts_director', '主任'),
          option('department.arts_member', '部员'),
        ],
      },
      {
        id: 'student_union.sports_center',
        label: '体育中心',
        selection: 'single',
        options: [
          option('domain.sports_lead', '负责人'),
          option('department.sports_director', '主任'),
          option('department.sports_member', '部员'),
        ],
      },
      {
        id: 'student_union.liaison_center',
        label: '联络中心',
        selection: 'single',
        options: [
          option('domain.liaison_lead', '负责人'),
          option('department.liaison_director', '主任'),
          option('department.liaison_member', '部员'),
        ],
      },
      {
        id: 'student_union.rights_development_center',
        label: '权益发展中心',
        selection: 'single',
        options: [
          option('domain.rights_development_lead', '负责人'),
          option('department.rights_development_director', '主任'),
          option('department.rights_development_member', '部员'),
        ],
      },
      {
        id: 'student_union.finance',
        label: '兼任岗位',
        selection: 'toggle',
        options: [option('student_union.finance', '财务负责人')],
      },
    ],
  },
  {
    id: 'youth_league',
    label: '电子系团委',
    groups: [
      threeLevelGroup(
        'youth_league.organization',
        '组织组',
        'youth_league.organization',
        ['副书记', '组长', '组员'],
        ['deputy_secretary', 'leader', 'member'],
      ),
      threeLevelGroup(
        'youth_league.freshman',
        '新生组',
        'youth_league.freshman',
        ['副书记', '组长', '组员'],
        ['deputy_secretary', 'leader', 'member'],
      ),
      threeLevelGroup(
        'youth_league.volunteer',
        '志愿组',
        'youth_league.volunteer',
        ['副书记', '组长', '组员'],
        ['deputy_secretary', 'leader', 'member'],
      ),
      threeLevelGroup(
        'youth_league.practice',
        '实践组',
        'youth_league.practice',
        ['副书记', '组长', '组员'],
        ['deputy_secretary', 'leader', 'member'],
      ),
      threeLevelGroup(
        'youth_league.humanities',
        '人文组',
        'youth_league.humanities',
        ['副书记', '组长', '组员'],
        ['deputy_secretary', 'leader', 'member'],
      ),
      threeLevelGroup(
        'youth_league.sail',
        '扬帆计划组',
        'youth_league.sail',
        ['顾问', '小导', '学员'],
        ['consultant', 'mentor', 'student'],
      ),
      {
        id: 'youth_league.finance',
        label: '兼任岗位',
        selection: 'toggle',
        options: [option('youth_league.finance', '财务负责人')],
      },
    ],
  },
  {
    id: 'tms',
    label: 'TMS 电子系分会',
    groups: [
      {
        id: 'tms.position',
        label: '分会身份',
        selection: 'single',
        options: [
          option('affiliation.tms_lead', '顾问'),
          option('affiliation.tms_director', '会长'),
          option('affiliation.tms_member', '会员'),
        ],
      },
    ],
  },
  {
    id: 'science_association',
    label: '电子系科协',
    groups: [
      {
        id: 'science_association.chair',
        label: '顶层身份',
        selection: 'toggle',
        options: [option('science_association.chair', '科协主席')],
      },
      ...[
        ['office', '办公室'],
        ['software', '软件部'],
        ['hardware', '硬件部'],
        ['training', '学培部'],
        ['project', '项目部'],
        ['planning', '策划部'],
      ].map(([key, label]) =>
        threeLevelGroup(
          `science_association.${key}`,
          label!,
          `science_association.${key}`,
          ['副主席', '部长', '部员'],
          ['vice_chair', 'minister', 'member'],
        ),
      ),
    ],
  },
  {
    id: 'media_center',
    label: '电子系学生媒体中心',
    groups: [
      threeLevelGroup(
        'media_center.creative',
        '创意设计部',
        'media_center.creative',
        ['顾问', '部长', '部员'],
        ['consultant', 'minister', 'member'],
      ),
      threeLevelGroup(
        'media_center.audiovisual',
        '影音策划部',
        'media_center.audiovisual',
        ['顾问', '部长', '部员'],
        ['consultant', 'minister', 'member'],
      ),
      threeLevelGroup(
        'media_center.new_media_reporters',
        '新媒体与记者团部',
        'media_center.new_media_reporters',
        ['顾问', '部长', '部员'],
        ['consultant', 'minister', 'member'],
      ),
      {
        id: 'media_center.finance',
        label: '兼任岗位',
        selection: 'toggle',
        options: [option('media_center.finance', '财务负责人')],
      },
    ],
  },
] as const;

const catalogOptions = DEVELOPMENT_IDENTITY_SECTIONS.flatMap(({ groups }) =>
  groups.flatMap(({ options }) => options),
);

export const DEVELOPMENT_IDENTITY_ROLE_KEYS: readonly RoleKey[] = [
  'platform.admin',
  ...catalogOptions.map(({ roleKey }) => roleKey),
];

export const DEVELOPMENT_IDENTITY_GROUPS: readonly DevelopmentIdentityGroup[] =
  DEVELOPMENT_IDENTITY_SECTIONS.flatMap(({ groups }) => groups);

export const DEVELOPMENT_IDENTITY_BY_ROLE = new Map(
  catalogOptions.map((identity) => [identity.roleKey, identity] as const),
);

const groupByRole = new Map(
  DEVELOPMENT_IDENTITY_GROUPS.flatMap((group) =>
    group.options.map(({ roleKey }) => [roleKey, group] as const),
  ),
);

export type IdentitySelectionValidation =
  { ok: true } | { ok: false; groupId: string; message: string };

export function validateIdentitySelection(roles: readonly RoleKey[]): IdentitySelectionValidation {
  const selected = new Set(roles);
  for (const group of DEVELOPMENT_IDENTITY_GROUPS) {
    if (group.selection !== 'single') continue;
    const count = group.options.filter(({ roleKey }) => selected.has(roleKey)).length;
    if (count > 1) {
      return {
        ok: false,
        groupId: group.id,
        message: `${group.label}只能选择一个身份`,
      };
    }
  }
  return { ok: true };
}

export function identityGroupForRole(roleKey: RoleKey): DevelopmentIdentityGroup | null {
  return groupByRole.get(roleKey) ?? null;
}

export function identityLabels(roles: readonly RoleKey[]): string[] {
  const selected = new Set(roles);
  const labels: string[] = [];
  if (selected.has('platform.admin')) labels.push('平台管理员');
  for (const { roleKey, label } of catalogOptions) {
    if (!selected.has(roleKey)) continue;
    const group = groupByRole.get(roleKey);
    if (
      group === undefined ||
      ['counselors.position', 'student_union.executive', 'science_association.chair'].includes(
        group.id,
      )
    ) {
      labels.push(label);
    } else if (group.id === 'tms.position') {
      labels.push(`TMS ${label}`);
    } else if (group.id === 'student_union.finance') {
      labels.push(`学生会${label}`);
    } else if (group.id === 'youth_league.finance') {
      labels.push(`团委${label}`);
    } else if (group.id === 'media_center.finance') {
      labels.push(`学生媒体中心${label}`);
    } else {
      labels.push(`${group.label}${label}`);
    }
  }
  return labels;
}
