import studentUnionScene from '../../assets/organizations/sheep-student-union.webp';
import youthLeagueScene from '../../assets/organizations/sheep-youth-league.webp';
import tmsScene from '../../assets/organizations/sheep-tms.webp';
import scienceAssociationScene from '../../assets/organizations/sheep-science-association.webp';
import mediaCenterScene from '../../assets/organizations/sheep-media-center.webp';

const organizationScenes: Record<string, { source: string; description: string }> = {
  student_union: {
    source: studentUnionScene,
    description: '学生会小羊正在筹备校园活动',
  },
  youth_league: {
    source: youthLeagueScene,
    description: '团委小羊正在用水墨画竹子',
  },
  tms: {
    source: tmsScene,
    description: 'TMS小羊坐着阅读一本书',
  },
  science_association: {
    source: scienceAssociationScene,
    description: '科协小羊正在动手调试机器人',
  },
  media_center: {
    source: mediaCenterScene,
    description: '媒中小羊正在用相机拍摄校园生活',
  },
};

export function OrganizationMark({ variant }: { variant: string }) {
  const scene = organizationScenes[variant];
  if (!scene) return null;
  return (
    <img
      className="organization-scene"
      src={scene.source}
      alt={scene.description}
      width={200}
      height={200}
      decoding="async"
    />
  );
}
