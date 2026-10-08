import {
  DEVELOPMENT_IDENTITY_SECTIONS,
  type DevelopmentIdentitySection,
  type SocialOrganizationId,
} from '@freebbs-development/contracts';

export interface OrganizationDepartment {
  key: string;
  name: string;
  introduction: string;
  focus: string[];
  organizationIds: SocialOrganizationId[];
  sharedActivityScope: boolean;
}

export interface OrganizationExhibit {
  key: DevelopmentIdentitySection['id'];
  name: string;
  shortName: string;
  motto: string;
  introduction: string;
  focus: string[];
  organizationIds: SocialOrganizationId[];
  departments: OrganizationDepartment[];
}

const departmentIntroductions: Record<string, { introduction: string; focus: string[] }> = {
  arts_center: {
    introduction: '让舞台属于每一个热爱表达的人。这里关注校园文艺活动、节目筹备与同学的创作交流。',
    focus: ['文艺活动', '节目筹备', '创作交流'],
  },
  sports_center: {
    introduction: '从日常运动到赛场上的并肩，连接同学、代表队与校园体育活动。',
    focus: ['体育赛事', '代表队支持', '日常运动'],
  },
  liaison_center: {
    introduction: '连接校园内外的资源，让合作机会与同学的想法相遇。',
    focus: ['资源对接', '合作交流', '机会共享'],
  },
  rights_development_center: {
    introduction: '倾听校园生活中的问题与建议，关注同学权益、生活体验和个人发展。',
    focus: ['权益反馈', '校园生活', '学生发展'],
  },
  organization: {
    introduction: '关注团组织建设与日常工作，让组织事务有序推进，让同学更方便参与。',
    focus: ['组织建设', '团务工作', '活动协作'],
  },
  freshman: {
    introduction: '陪伴新同学探索大学生活，通过交流与工作坊，把初来的愿望变成可以一起尝试的事。',
    focus: ['新生交流', '工作坊', '校园适应'],
  },
  volunteer: {
    introduction: '连接志愿服务机会与愿意行动的同学，在服务与协作中积累经历。',
    focus: ['志愿服务', '项目招募', '服务交流'],
  },
  practice: {
    introduction: '从支队筹备到行程分享，关注社会实践、支队交流与实践资源。',
    focus: ['社会实践', '支队交流', '实践资源'],
  },
  humanities: {
    introduction: '在阅读、对话与文化活动中，发现专业之外更宽广的校园生活。',
    focus: ['人文活动', '文化交流', '阅读分享'],
  },
  sail: {
    introduction: '通过同伴陪伴、活动交流与共同探索，帮助新同学找到适合自己的成长方向。',
    focus: ['同伴陪伴', '成长交流', '活动探索'],
  },
  office: {
    introduction: '关注科协日常协调与资料整理，为各部门协作和活动开展提供支持。',
    focus: ['事务协调', '资料整理', '组织协作'],
  },
  software: {
    introduction: '聚集热爱编程的同学，在软件开发、技术交流与项目实践中共同学习。',
    focus: ['软件开发', '编程交流', '项目实践'],
  },
  hardware: {
    introduction: '从电路与器件出发，在动手搭建和技术实践中探索硬件的可能。',
    focus: ['电路实践', '硬件制作', '技术交流'],
  },
  training: {
    introduction: '分享实用的学习方法与技术工具，通过培训和交流帮助同学迈出第一步。',
    focus: ['技能培训', '学习交流', '工具入门'],
  },
  project: {
    introduction: '连接项目想法与实践伙伴，在协作、展示和经验交流中推进科创探索。',
    focus: ['科创项目', '团队协作', '成果交流'],
  },
  planning: {
    introduction: '把技术活动的想法变成清楚的安排，关注策划、组织和活动体验。',
    focus: ['活动策划', '赛事协作', '活动组织'],
  },
};

const exhibitionDefinitions: Array<
  Pick<
    OrganizationExhibit,
    'key' | 'name' | 'shortName' | 'motto' | 'introduction' | 'focus' | 'organizationIds'
  >
> = [
  {
    key: 'student_union',
    name: '电子系学生会',
    shortName: '学生会',
    motto: '让校园生活，多一种可能。',
    introduction:
      '从舞台到赛场，从资源连接到校园生活，学生会的四个中心一起回应同学的需求，让每个人都能找到参与的入口。',
    focus: ['文艺', '体育', '联络', '权益与发展'],
    organizationIds: [
      'arts_center',
      'sports_center',
      'liaison_center',
      'rights_development_center',
    ],
  },
  {
    key: 'youth_league',
    name: '电子系团委',
    shortName: '团委',
    motto: '一起出发，也彼此陪伴。',
    introduction:
      '组织、新生、志愿、实践、人文与扬帆计划，连接大学生活中不同的探索路径，让参与、交流与成长持续发生。',
    focus: ['组织建设', '志愿实践', '人文交流', '新生成长'],
    organizationIds: ['tuanwei'],
  },
  {
    key: 'tms',
    name: '电子系TMS分会',
    shortName: 'TMS',
    motto: '在思考与行动之间，相互启发。',
    introduction:
      '以理论学习、主题交流和共同参与为纽带，为同学提供学习讨论、活动报名与经历分享的空间。',
    focus: ['理论学习', '主题交流', '活动参与'],
    organizationIds: ['tms'],
  },
  {
    key: 'science_association',
    name: '电子系科协',
    shortName: '科协',
    motto: '把好奇，变成亲手做出的答案。',
    introduction:
      '连接软件、硬件、学习培训与项目实践，为想动手、想探索的同学提供技术交流和一起创造的机会。',
    focus: ['软件硬件', '学习培训', '项目实践', '活动策划'],
    organizationIds: ['sast'],
  },
];

export const ORGANIZATION_GALLERY: readonly OrganizationExhibit[] = exhibitionDefinitions.map(
  (definition) => {
    const section = DEVELOPMENT_IDENTITY_SECTIONS.find(({ id }) => id === definition.key)!;
    return {
      ...definition,
      departments: section.groups
        .filter(({ id }) => !/\.(executive|chair|position|finance)$/.test(id))
        .map((group) => {
          const key = group.id.split('.').at(-1)!;
          const details = departmentIntroductions[key];
          return {
            key,
            name: group.label,
            introduction: details?.introduction ?? '了解部门工作，发现可以一起参与的活动。',
            focus: details?.focus ?? [],
            organizationIds:
              definition.key === 'student_union'
                ? [key as SocialOrganizationId]
                : [...definition.organizationIds],
            sharedActivityScope: definition.key !== 'student_union',
          };
        }),
    };
  },
);

export function findOrganization(key: string): OrganizationExhibit | undefined {
  return ORGANIZATION_GALLERY.find((item) => item.key === key);
}

export function organizationRegistrationPath(ids: readonly SocialOrganizationId[]): string {
  return `/collections/registrations?${new URLSearchParams({ organization: ids.join(',') }).toString()}`;
}
