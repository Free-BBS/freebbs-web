import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const sharp = process.env.SHOWCASE_SHARP_PATH
  ? require(process.env.SHOWCASE_SHARP_PATH)
  : (() => {
      try {
        return require('sharp');
      } catch {
        return createRequire(path.join(repo, '..', 'freebbs-web', 'package.json'))('sharp');
      }
    })();
const materialRoot = path.resolve(repo, '../../..', '66 发展端/组织风采');
const publicRoot = path.join(repo, 'development/apps/web/public/organization-showcase/content');
const qaRoot = path.resolve(repo, '../../..', 'tmp/org-content-qa');
const departments = {
  practice: {
    folder: '实践组/配图',
    files: [
      'intro-image1.jpeg',
      'intro-image2.jpeg',
      'intro-image3.png',
      ...Array.from({ length: 8 }, (_, index) => `practice-image${index + 1}.jpeg`),
    ],
  },
  volunteer: {
    folder: '志愿组',
    files: ['志愿组合照-用户指定封面.jpg'],
  },
  arts: {
    folder: '学生文艺中心',
    files: [
      '封面（掠影学生节大合影）.jpg',
      '部门介绍出插图（系歌赛合影）.jpg',
      '部门介绍处插图（free之夜合影）.jpg',
      '部门介绍处插图（毕业舞会合影）.jpg',
    ],
  },
  project: {
    folder: '项目部',
    files: ['图1.png', '图2.jpg', '图3.jpg', '图4.jpg', '图5.png'],
  },
  tms: {
    folder: '电子系TMS分会',
    files: [
      'cover.jpg',
      '01_jingsai.jpg',
      '02_jingsai.jpg',
      '02_guben.jpg',
      '03_shengen.jpg',
      '04_wusheng.jpg',
      '05_lecture.jpg',
      '06_shijian.jpg',
    ],
  },
  sports: {
    folder: '学生体育中心/2 部门展示环节',
    files: [
      '体育中心/26年小马杯提前项.jpg',
      '体育中心/26年大马杯季军.jpg',
      '体育中心/26-27第一次部会.jpg',
      '体育中心/25新生赤足.jpg',
      '体育中心/25年大马杯亚军.jpg',
      '体育中心/25学生节掠影打下班卡.jpg',
      '体育中心/25-26第一次部会.jpg',
      '体育中心/25-26告别部会.jpg',
      '天天开心/六世（部长）同堂.jpg',
      '天天开心/一起跨年的牢哥牢姐们.jpg',
      '天天开心/呜呼我们是亚军！.jpg',
      '天天开心/转身能看到老部长们的后背.jpg',
      '天天开心/见证国足U23大胜的体育中心.jpg',
      '天天开心/被牢哥们巧手化妆的牢哥们（25男生节）.jpg',
      '天天开心/愉快的25年男生（受难）节.jpg',
      '天天开心/天天开心（沙滩版）.jpg',
    ],
  },
  freshman: {
    folder: '新生组',
    files: [
      '合影.jpg',
      '迎新现场.jpg',
      '辅导员视频.jpg',
      '辅导员热舞.jpg',
      'free之夜合影.jpg',
      '团建1.jpg',
      '团建2.jpg',
    ],
  },
  rights: {
    folder: '权益发展中心',
    files: [
      '微信图片_20251212203359_191_653.jpg',
      '_E5_BE_AE_E4_BF_A1_E5_9B_BE_E7_89_87_20251212203356_188_653.jpg',
      'c05cce3171084f6051ee2e300c098e1d-sz_5097626 (1).webp',
      '93队_1.jpg',
      '7999d8f81bdb4207d2771e37289897b7-sz_81263.webp',
    ],
  },
  'new-media': {
    folder: '新媒体部/图片资源',
    files: [
      '图片1.png',
      '图片2.png',
      '图片3.png',
      '图片4.png',
      '图片5.png',
      '图片6.png',
      '图片7.jpg',
      '图片8.jpg',
    ],
  },
};

function ensureChild(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Unsafe path: ${candidate}`);
  return candidate;
}

const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex === -1 ? undefined : process.argv[onlyIndex + 1];
if (onlyIndex !== -1 && (!only || !Object.hasOwn(departments, only)))
  throw new Error(`Unknown department: ${only ?? '(missing --only value)'}`);
const report = {};
await fs.mkdir(qaRoot, { recursive: true });
for (const [departmentId, entry] of Object.entries(departments)) {
  if (only && departmentId !== only) continue;
  const outputDir = ensureChild(publicRoot, path.join(publicRoot, departmentId));
  await fs.mkdir(outputDir, { recursive: true });
  const prepared = [];
  for (const [index, filename] of entry.files.entries()) {
    const source = ensureChild(materialRoot, path.join(materialRoot, entry.folder, filename));
    const stem =
      departmentId === 'tms' ? path.parse(filename).name : `${String(index + 1).padStart(2, '0')}`;
    const target = ensureChild(outputDir, path.join(outputDir, `${stem}.webp`));
    const info = await sharp(source)
      .rotate()
      .resize({
        width: ['arts', 'project'].includes(departmentId) ? 2000 : 1600,
        height: 1800,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: ['arts', 'project'].includes(departmentId)
          ? 86
          : departmentId === 'new-media' && index < 6
            ? 88
            : 84,
        effort: 5,
      })
      .toFile(target);
    prepared.push({
      filename,
      url: `/development/organization-showcase/content/${departmentId}/${stem}.webp`,
      width: info.width,
      height: info.height,
      bytes: info.size,
    });
  }
  const thumbW = 400,
    thumbH = 300;
  const columns = 3;
  const tiles = await Promise.all(
    prepared.map(async (entry, index) => ({
      input: await sharp(path.join(outputDir, path.basename(entry.url)))
        .resize(thumbW, thumbH, { fit: 'contain', background: '#e5e8ee' })
        .png()
        .toBuffer(),
      left: (index % columns) * thumbW,
      top: Math.floor(index / columns) * thumbH,
    })),
  );
  await sharp({
    create: {
      width: columns * thumbW,
      height: Math.ceil(prepared.length / columns) * thumbH,
      channels: 3,
      background: '#e5e8ee',
    },
  })
    .composite(tiles)
    .png()
    .toFile(path.join(qaRoot, `${departmentId}.png`));
  report[departmentId] = prepared;
}
await fs.writeFile(path.join(qaRoot, 'assets.json'), JSON.stringify(report, null, 2));
const dimensionsFile = path.join(
  repo,
  'development/apps/web/src/modules/organizations/showcase/image-dimensions.json',
);
const existingDimensions = only ? JSON.parse(await fs.readFile(dimensionsFile, 'utf8')) : {};
await fs.writeFile(
  dimensionsFile,
  JSON.stringify(
    {
      ...existingDimensions,
      ...Object.fromEntries(
        Object.values(report)
          .flat()
          .map(({ url, width, height }) => [url, { width, height }]),
      ),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(report).map(([id, assets]) => [
        id,
        { count: assets.length, bytes: assets.reduce((sum, item) => sum + item.bytes, 0) },
      ]),
    ),
  ),
);
