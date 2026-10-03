#!/usr/bin/env python3
"""Keep every shipped website route reachable from the iPhone client."""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
# Context routes are reached from their parent workspace with the original query.
CONTEXT = {'/course', '/knowledge', '/course-map-editor', '/circuit-embed', '/publish'}
PAGES = {
    '/': ('今日', '学习', 'sun.max', '课程、签到与讨论动态'),
    '/world': ('学习世界', '学习', 'globe', '知识岛、完整课程地图与学习记录'),
    '/course': ('课程工作区', '学习', 'books.vertical', '课程地图、学习进度、资料上传与管理'),
    '/knowledge': ('知识点工作区', '学习', 'point.3.connected.trianglepath.dotted', '学习概览、正文、编辑、历史与讨论'),
    '/course-map-editor': ('编辑课程地图', '学习', 'pencil.and.outline', '知识结点、连接和地图背景'),
    '/search': ('全站搜索', '学习', 'magnifyingglass', '跨课程、知识点与讨论查找内容'),
    '/workbench': ('完整工作台', '计划与活动', 'calendar', '计划表、校园连接、课程公告与作业'),
    '/surveys': ('活动报名', '计划与活动', 'ticket', '报名、回执及抽签结果'),
    '/discussion': ('完整讨论工作区', '社区与创作', 'bubble.left.and.bubble.right', '投票、悬赏、编辑、互动与版主管理'),
    '/publish': ('完整发表工作区', '社区与创作', 'square.and.pencil', '编辑、预览及实验和工具分享'),
    '/aichat': ('Max 完整工作区', '社区与创作', 'sparkles', '历史对话、模型、附件与创作工具'),
    '/markdown-editor': ('Markdown 编辑器', '社区与创作', 'text.document', '知识点文档编辑、公式预览与图片上传'),
    '/creative-workshop': ('创意工坊', '社区与创作', 'paintbrush', '创意工坊的规划与介绍'),
    '/pbl': ('PBL 计划', '计划与活动', 'person.3', '项目学习的规划与说明'),
    '/laboratory': ('全部实验室', '实验与工具', 'flask', '代码、电路和工具工作区'),
    '/circuits': ('电路库', '实验与工具', 'cpu', '创建、打开、导入与管理电路'),
    '/circuit': ('电路实验室', '实验与工具', 'cpu', '电路编辑、Max 助手、版本与仿真'),
    '/circuit-embed': ('电路引用', '实验与工具', 'link', '查看被分享的电路及指定版本'),
    '/circuit-challenge': ('电路挑战', '实验与工具', 'bolt.badge.clock', '关卡、目标波形与排行榜'),
    '/code-lab': ('完整代码实验室', '实验与工具', 'curlybraces', '各运行环境、汇编与实验结果'),
    '/tool-workshop': ('完整工具工坊', '实验与工具', 'hammer', '管理工具、AI 制作、版本和分享'),
    '/profile': ('个人主页', '个人与牧场', 'person.crop.circle', '公开资料、动态、徽章、签到记录与牧场'),
    '/settings': ('全部个人设置', '个人与牧场', 'gearshape', '头像、阅读样式、邮件通知、邮箱与学号'),
    '/electromagnetic': ('电磁场商城', '个人与牧场', 'bag', '商城、兑换、赠送与道具'),
    '/inventory': ('仓库与钱包', '个人与牧场', 'shippingbox', '物品、使用、出售与钱包账本'),
    '/ranch': ('电子牧场', '个人与牧场', 'leaf', '牧场互动、养成与学习'),
    '/ranch-dye': ('羊的染坊', '个人与牧场', 'paintpalette', '羊群配色、造型与设计'),
    '/ranch-gallery': ('羊群广场', '个人与牧场', 'person.2', '浏览大家的牧场并互动'),
    '/guide': ('Max 探索手册', '帮助', 'book.closed', '功能引导与完成奖励'),
    '/about': ('关于 FREE-BBS', '帮助', 'info.circle', '平台介绍与相关信息'),
    '/staff': ('工作人员', '帮助', 'person.2.badge.gearshape', '工作人员及公开联系方式'),
    '/login': ('登录', '账号', 'person.crop.circle', '登录和互动验证'),
    '/register': ('注册', '账号', 'person.badge.plus', '邮箱、白名单与互动验证'),
    '/remake': ('找回密码', '账号', 'key', '邮箱验证与密码恢复'),
    '/adminusers': ('用户管理', '管理', 'person.2.badge.key', '账号、学号绑定与白名单'),
    '/system-settings': ('管理员端', '管理', 'gearshape.2', '管理功能总览'),
    '/system-settings/announcements': ('公告管理', '管理', 'megaphone', '发布、修改和管理公告'),
    '/system-settings/rewards': ('奖励方案', '管理', 'gift', '奖励发放与记录'),
    '/system-settings/model': ('模型与密钥', '管理', 'key.horizontal', '模型配置及 API key'),
    '/system-settings/course-materials': ('课程资料管理', '管理', 'folder', '资料根目录、文件与权限'),
    '/system-settings/surveys': ('报名活动管理', '管理', 'checklist', '活动、报名详情与抽签'),
    '/development': ('发展端入口', '发展端', 'arrow.up.right.square', '平台介绍与功能入口'),
}
DEVELOPMENT = {
    'dashboard': ('发展端总览', 'square.grid.2x2'),
    'shop': ('发展端商城', 'bag'),
    'inventory': ('发展端仓库', 'shippingbox'),
    'profile': ('发展端个人主页', 'person.crop.circle'),
    'settings': ('发展端个人设置', 'gearshape'),
    'knowledge': ('知识平台', 'books.vertical'),
    'information': ('信息服务', 'info.bubble'),
    'information/announcements': ('发展端公告', 'megaphone'),
    'information/consultations': ('我的咨询', 'bubble.left'),
    'information/triage': ('咨询处理', 'tray.full'),
    'information/proposals': ('提案池', 'lightbulb'),
    'growth': ('成长与兴趣社群', 'person.3'),
    'interest-groups': ('兴趣小组', 'person.3'),
    'clubs': ('社团', 'person.3'),
    'events': ('活动与招募', 'calendar.badge.plus'),
    'events/student-festival': ('学生节', 'party.popper'),
    'collections': ('作品征集', 'square.stack'),
    'collections/registrations': ('征集报名', 'list.clipboard'),
    'collections/mine': ('我的征集报名', 'person.text.rectangle'),
    'collections/showcase': ('作品展示', 'photo.on.rectangle'),
    'community': ('发展端社区', 'bubble.left.and.bubble.right'),
    'liaison': ('学生联络', 'person.wave.2'),
    'sports': ('体育与队伍', 'sportscourt'),
    'sports/matches': ('体育赛程', 'flag.checkered'),
    'finance': ('财务工作区', 'chart.bar.doc.horizontal'),
    'admin': ('发展端管理', 'gearshape.2'),
}
source = (ROOT / 'server.js').read_text()
routes = dict(re.findall(r"\['(/[^']*)', '(/[^']+\.html)'\]", source.split('const htmlRedirects')[0]))
routes['/'] = '/index.html'
missing = set(routes) - set(PAGES)
extra = set(PAGES) - set(routes)
if missing or extra:
    raise SystemExit(f'Website route catalog needs review: missing={sorted(missing)}, extra={sorted(extra)}')
entries = []
for path, (title, group, symbol, detail) in PAGES.items():
    entries.append(dict(path=path, title=title, group=group, symbol=symbol, detail=detail,
                        listed=path not in CONTEXT and path not in {'/', '/login', '/register', '/remake'},
                        admin=group == '管理', login=group == '管理' or path in {'/settings', '/electromagnetic', '/inventory', '/ranch-dye'},
                        native=path in {'/', '/login', '/register', '/remake', '/laboratory', '/circuits', '/circuit', '/circuit-challenge'}))
router = (ROOT / 'development/apps/web/src/app/router.tsx').read_text()
dev_routes = re.findall(r"\bpath:\s*'([^']+)'", router)
patterns = []
for route in dev_routes:
    if route in {'*', '/'}:
        continue
    segments = route.split('/')
    pattern = '^/development/' + '/'.join('[^/]{1,256}' if s.startswith(':') else re.escape(s) for s in segments) + '$'
    patterns.append(pattern)
    if ':' not in route and route in DEVELOPMENT:
        title, symbol = DEVELOPMENT[route]
        entries.append(dict(path='/development/' + route, title=title, group='发展端', symbol=symbol,
                            detail='按当前账号权限浏览与操作', listed=True,
                            admin=route == 'admin', login=route in {'admin', 'finance'}, native=False))
    elif ':' not in route:
        raise SystemExit(f'Development navigation needs a title and entry: {route}')
aliases = {value: key for key, value in routes.items()}
redirect_source = source.split('const htmlRedirects = new Map([', 1)[1].split(']);', 1)[0]
# /circuits shares circuit.html with /circuit; the declared redirect, rather
# than inversion order, determines how an existing HTML deep link behaves.
aliases.update(dict(re.findall(r"\['(/[^']+\.html)', '(/[^']*)'\]", redirect_source)))
document = json.dumps(dict(entries=entries, aliases=aliases, developmentPatterns=patterns), ensure_ascii=False, indent=2) + '\n'
target = ROOT / 'ios/FreeBBS/Resources/FeatureCatalog.json'
if '--check' in sys.argv:
    if not target.exists() or target.read_text() != document:
        raise SystemExit('FeatureCatalog.json is stale; run generate-feature-catalog.py')
else:
    target.write_text(document)
print(f'Website parity catalog: {len(routes)} page routes, {len(patterns)} development routes, {len(entries)} entries')
