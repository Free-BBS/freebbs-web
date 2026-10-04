# 主站原生页面与功能审查（build 13）

底部保持网页顺序「首页、讨论、＋、学习、工具」，全站搜索独立位于右下角。发布、学习、工具使用 SwiftUI Menu 点按展开的系统浮动菜单；导航与操作层使用系统 Liquid Glass，发布为白色加号配实色强调底。底部栏在整层 NavigationStack 外保留，进入子页面后仍可切换；搜索展开后使用原生输入框与键盘。此为自定义 SwiftUI 玻璃导航栏，不能描述为系统 Tab(role: .search)。

41 个主站页面的路由都改为原生 SwiftUI 业务界面，不再加载完整网站页面作为业务 UI。发展端及其 HTML 别名、详情和管理路由继续排除。富文本、HTML 工具执行、复杂电路画布及仿真、牧场背景/羊动画/学习读数仍使用受限内容渲染器；校园外部授权页使用隔离 WebKit，不注入账号 token 或业务脚本。不能将内容引擎描述为纯 SwiftUI。

## 业务流程

| 范围 | 原生操作 |
| --- | --- |
| 搜索与目录 | 右下角全站搜索、类别与分页、保留查询参数的页面跳转；三组菜单顺序来自网站导航 |
| 课程与文档 | 课程选择、知识点与关系浏览、资料预览、分区 Markdown 编辑/预览、图片插入、地图结点/连接/背景编辑；文档保存携带 SHA-256 版本 |
| 工作台 | 七天列表/横向视图、日程与截止事项、重复事件/课程、当前及后续安排编辑、重要事项、作业完成状态；Max 规划预览/选择/确认、个人空档与规划偏好 |
| 校园 | 连接状态、原生凭据输入或独立授权、断开、同步进度、学期课程/公告、接入预览、作业详情及系统附件预览 |
| 讨论 | 最新/热门/待解答、版块、发帖/预览/图片/匿名/登录可见、分层回复/点赞/删除、@Max 一次同意、隐藏/置顶/精华与匿名作者核验、版块说明/版主管理 |
| Max | 原生对话、历史、模型与思考强度、图片与文档附件、100 MB 分块上传、文档逐页预览、后台任务/停止/恢复回答、图片及站内导航结果 |
| 签到与足迹 | 原生签到月历、今日运势、连续签到与奖励回执、按账号/北京时间同步；首页和个人主页的全年贡献热力图与每日数量 |
| 设置与个人 | 头像、简介/网页、用户名/密码、邮箱验证码/学号申请、阅读样式、外观、邮件偏好、AI 同意撤回、屏蔽/政策/删除申请、公开活跃度、两种头像框/四种名牌/两种主页卡片的装备与原生展示、金色名字及服务端有效期 |
| 钱包与商城 | 商品、报价确认/购买、赠与、鱼骨出售、微分器兑换、黄金名片、激光器续期与钱包分页；交易重试保留原请求编号 |
| 牧场 | 原生导航、照顾表单与学习控制，受限 HTML 场景复用网站照片、羊动画、共享 SSE 和时钟/倒计时；原生染色、花纹/混合/角饰/撤销、共享场景与羊群操作、领养/喂食/剪毛/摩擦/福袋、装备、时钟与专注计时 |
| 实验室 | 原生代码/参数/执行/调试/结果/分享、工具编辑/生成/预览、原生电路列表/参数/操作栏加受限仿真画布 |
| 导引与介绍 | 从网站内容生成的原生探索手册、按账号同步导引进度与一次奖励、工作人员；PBL/创意工坊沿用网站当前建设状态 |
| 管理 | 权限控制的用户表单、模型密钥/资料目录、公告受众/发布、奖励方案/回执、活动草稿/发布/复制/抽签/报名资料/CSV 导出 |

## 验证边界

路由覆盖与原生控件存在不能证明每项真实业务已验收。Debug 示例模式禁止线上写入；本轮自动测试覆盖导航、布局、编码、账号隔离和受限渲染。没有使用正式 FREE-BBS 测试账号执行校园登录、发帖、报名、交易、头像/资料保存、AI 生成或管理员写入，相关服务必须在真实账号与实际部署配置下验收。

build 13 的牧场场景恢复网站连续运动、事件动画与 SSE 引擎，操作层使用 SwiftUI；示例模式仅使用离线场景，不连接线上 API。真实账号羊群同步和照顾写入仍需人工验收。部分进阶交互（Max 作品跨工作区草稿交接、管理员批量账号/学号申请队列、地图拖拽编辑）仍须继续完善；不能对外宣称全部网页子功能已完成等价复刻。主站已有的内容/笔记等建设中功能不伪造成可用。

`generate-feature-catalog.py --check` 校验主站路由/导航一致；`generate-native-information.py --check` 校验介绍、导引和工作人员资源；`bundle-rich-content.py --check` 校验受限内容渲染资源与网站源。保存、发布、权限和交易仍由既有后端校验。物理设备、真实照片/文件提供者及 VoiceOver 人工验收待补齐；正式 App Store 门槛仍由 ReleaseStatus.json 管理。

## 全部主站页面

| 页面 | 功能 | 手机 UI |
| --- | --- | --- |
| `/` | 首页 | SwiftUI |
| `/world` | 学习世界 | SwiftUI |
| `/course` | 课程工作区 | SwiftUI |
| `/knowledge` | 知识点工作区 | SwiftUI |
| `/course-map-editor` | 编辑课程地图 | SwiftUI |
| `/search` | 全站搜索 | SwiftUI |
| `/workbench` | 我的工作台 | SwiftUI |
| `/surveys` | 活动报名（试用） | SwiftUI |
| `/discussion` | 讨论区 | SwiftUI |
| `/publish` | 发表讨论 | SwiftUI |
| `/aichat` | 问问 Max | SwiftUI |
| `/markdown-editor` | Markdown 编辑器 | SwiftUI |
| `/creative-workshop` | 创意工坊 | SwiftUI |
| `/pbl` | PBL 计划 | SwiftUI |
| `/laboratory` | 实验室 | SwiftUI |
| `/circuits` | 电路库 | SwiftUI 控件 + 受限电路场景 |
| `/circuit` | 电路实验室 | SwiftUI 控件 + 受限电路场景 |
| `/circuit-embed` | 电路引用 | SwiftUI 控件 + 受限电路场景 |
| `/circuit-challenge` | 电路挑战 | SwiftUI 控件 + 受限电路场景 |
| `/code-lab` | 代码实验室 | SwiftUI |
| `/tool-workshop` | 工具工坊 | SwiftUI |
| `/profile` | 个人主页 | SwiftUI |
| `/settings` | 个人设置 | SwiftUI |
| `/electromagnetic` | 电磁场商城 | SwiftUI |
| `/inventory` | 仓库与钱包 | SwiftUI |
| `/ranch` | 电子牧场 | SwiftUI 控件 + 受限牧场场景 |
| `/ranch-dye` | 羊的染坊 | SwiftUI |
| `/ranch-gallery` | 羊群广场 | SwiftUI 控件 + 受限牧场场景 |
| `/guide` | Max 探索手册 | SwiftUI |
| `/about` | 关于 FREE-BBS | SwiftUI |
| `/staff` | 工作人员 | SwiftUI |
| `/login` | 登录 | SwiftUI |
| `/register` | 注册 | SwiftUI |
| `/remake` | 找回密码 | SwiftUI |
| `/adminusers` | 用户管理 | SwiftUI |
| `/system-settings` | 管理员端 | SwiftUI |
| `/system-settings/announcements` | 公告管理 | SwiftUI |
| `/system-settings/rewards` | 奖励方案 | SwiftUI |
| `/system-settings/model` | 模型与密钥 | SwiftUI |
| `/system-settings/course-materials` | 课程资料管理 | SwiftUI |
| `/system-settings/surveys` | 报名活动管理 | SwiftUI |
