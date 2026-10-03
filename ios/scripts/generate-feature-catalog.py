#!/usr/bin/env python3
"""Keep main-site pages and website navigation in sync with the iPhone client."""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
# Context routes are reached from their parent workspace with the original query.
CONTEXT = {'/course', '/knowledge', '/course-map-editor', '/circuit-embed', '/publish'}
PAGES = {
    '/': ('首页', '首页', 'house', '课程、签到与讨论动态'),
    '/world': ('学习世界', '学习', 'globe', '知识岛、完整课程地图与学习记录'),
    '/course': ('课程工作区', '学习', 'books.vertical', '课程地图、学习进度、资料上传与管理'),
    '/knowledge': ('知识点工作区', '学习', 'point.3.connected.trianglepath.dotted', '学习概览、正文、编辑、历史与讨论'),
    '/course-map-editor': ('编辑课程地图', '学习', 'pencil.and.outline', '知识结点、连接和地图背景'),
    '/search': ('全站搜索', '学习', 'magnifyingglass', '跨课程、知识点与讨论查找内容'),
    '/workbench': ('我的工作台', '计划与活动', 'calendar', '计划表、校园连接、课程公告与作业'),
    '/surveys': ('活动报名（试用）', '计划与活动', 'ticket', '报名、回执及抽签结果'),
    '/discussion': ('完整讨论工作区', '社区与创作', 'bubble.left.and.bubble.right', '投票、悬赏、编辑、互动与版主管理'),
    '/publish': ('完整发表工作区', '社区与创作', 'square.and.pencil', '编辑、预览及实验和工具分享'),
    '/aichat': ('Max 完整工作区', '社区与创作', 'sparkles', '历史对话、模型、附件与创作工具'),
    '/markdown-editor': ('Markdown 编辑器', '社区与创作', 'text.document', '知识点文档编辑、公式预览与图片上传'),
    '/creative-workshop': ('创意工坊', '社区与创作', 'paintbrush', '创意工坊的规划与介绍'),
    '/pbl': ('PBL 计划', '计划与活动', 'person.3', '项目学习的规划与说明'),
    '/laboratory': ('实验室', '实验与工具', 'flask', '代码、电路和工具工作区'),
    '/circuits': ('电路库', '实验与工具', 'cpu', '创建、打开、导入与管理电路'),
    '/circuit': ('电路实验室', '实验与工具', 'cpu', '电路编辑、Max 助手、版本与仿真'),
    '/circuit-embed': ('电路引用', '实验与工具', 'link', '查看被分享的电路及指定版本'),
    '/circuit-challenge': ('电路挑战', '实验与工具', 'bolt.badge.clock', '关卡、目标波形与排行榜'),
    '/code-lab': ('完整代码实验室', '实验与工具', 'curlybraces', '各运行环境、汇编与实验结果'),
    '/tool-workshop': ('完整工具工坊', '实验与工具', 'hammer', '管理工具、AI 制作、版本和分享'),
    '/profile': ('个人主页', '个人与牧场', 'person.crop.circle', '公开资料、动态、徽章、签到记录与牧场'),
    '/settings': ('个人设置', '个人与牧场', 'gearshape', '头像、阅读样式、邮件通知、邮箱与学号'),
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
}
# Development is intentionally unavailable on iPhone, including its HTML alias.
EXCLUDED = {'/development'}
source = (ROOT / 'server.js').read_text()
routes = dict(re.findall(r"\['(/[^']*)', '(/[^']+\.html)'\]", source.split('const htmlRedirects')[0]))
routes['/'] = '/index.html'
routes = {path: html for path, html in routes.items() if path not in EXCLUDED}
missing = set(routes) - set(PAGES)
extra = set(PAGES) - set(routes)
if missing or extra:
    raise SystemExit(f'Website route catalog needs review: missing={sorted(missing)}, extra={sorted(extra)}')
# Directory parents follow the website's shared main navigation.
parents = {
    '学习世界': ['/world', '/course', '/knowledge', '/course-map-editor', '/search', '/markdown-editor'],
    '讨论区': ['/discussion', '/publish'],
    '我的工作台': ['/workbench'],
    '实验室': ['/laboratory', '/circuits', '/circuit', '/circuit-embed', '/circuit-challenge', '/code-lab', '/tool-workshop'],
    '创意工坊': ['/creative-workshop'],
    'PBL计划': ['/pbl'],
    '问问 Max': ['/aichat'],
    '活动报名（试用）': ['/surveys'],
    '个人设置': ['/settings'],
}
parent_for_path = {path: parent for parent, paths in parents.items() for path in paths}
entries = []
for path, (title, group, symbol, detail) in PAGES.items():
    entries.append(dict(path=path, title=title, group=parent_for_path.get(path, group), symbol=symbol, detail=detail,
                        listed=path not in CONTEXT and path not in {'/', '/login', '/register', '/remake'},
                        admin=group == '管理', login=group == '管理' or path in {'/settings', '/electromagnetic', '/inventory', '/ranch-dye'},
                        native=path in {'/', '/login', '/register', '/remake', '/laboratory', '/circuits', '/circuit', '/circuit-challenge'}))
aliases = {value: key for key, value in routes.items()}
redirect_source = source.split('const htmlRedirects = new Map([', 1)[1].split(']);', 1)[0]
# /circuits shares circuit.html with /circuit; the declared redirect, rather
# than inversion order, determines how an existing HTML deep link behaves.
aliases.update({html: path for html, path in re.findall(r"\['(/[^']+\.html)', '(/[^']*)'\]", redirect_source) if path not in EXCLUDED})
# Read the actual mobile menus; a web navigation change invalidates this bundle.
mobile = (ROOT / 'public/mobile-shell.js').read_text()
def menu(name):
    block = re.search(r'const ' + name + r' = \[([\s\S]*?)\n  \];', mobile)
    if not block:
        raise SystemExit(f'Website mobile menu missing: {name}')
    return [dict(path=path, title=title, symbol=PAGES[path][2])
            for path, _icon, title in re.findall(r"\['([^']+)', '([^']*)', '([^']*)'\]", block[1]) if path not in EXCLUDED]
primary = menu('primary')
primary.append(dict(path='tools', title='工具', symbol='wrench.and.screwdriver'))
create = re.search(r"for \(const item of \[([\s\S]*?)\]\) \{", mobile)[1]
create_paths = re.findall(r"\['([^']+)', '[^']*', '[^']*'\]", create)
learning_paths = ['/world', '/laboratory', '/creative-workshop']
# Assert the leaf entries still occur in the website's learning menu in this order.
learning_block = mobile.split('const learningMenu =', 1)[1].split('const closeLearning', 1)[0]
positions = [learning_block.index("'" + path + "'") for path in learning_paths]
if positions != sorted(positions):
    raise SystemExit('Review changed website learning navigation')
def items(paths):
    return [dict(path=path, title=PAGES[path][0], symbol=PAGES[path][2]) for path in paths]
create_items = items(create_paths)
for item, (_, label) in zip(create_items, re.findall(r"\['[^']+', '([^']*)', '([^']*)'\]", create)):
    item['title'] = label
navigation = dict(primary=primary, create=create_items, learning=items(learning_paths), tools=menu('tools'))
main_nav = (ROOT / 'public/app.js').read_text().split('const navItems = [', 1)[1].split('];', 1)[0]
ordered_parents = [parent_for_path[path] for path, _label in re.findall(r"href: '([^']+)'[\s\S]*?label: '([^']+)'", main_nav) if path in parent_for_path]
if set(ordered_parents) != set(parents):
    raise SystemExit('Review changed website main navigation')
directory = ordered_parents + ['个人与牧场', '管理', '帮助']
document = json.dumps(dict(entries=entries, aliases=aliases, navigation=navigation, directory=directory), ensure_ascii=False, indent=2) + '\n'
target = ROOT / 'ios/FreeBBS/Resources/FeatureCatalog.json'
if '--check' in sys.argv:
    if not target.exists() or target.read_text() != document:
        raise SystemExit('FeatureCatalog.json is stale; run generate-feature-catalog.py')
else:
    target.write_text(document)
print(f'Main-site catalog: {len(routes)} page routes; development excluded; website bottom navigation synchronized')
