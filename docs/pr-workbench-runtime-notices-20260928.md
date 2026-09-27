# 工作台布局、牧场入口与运行环境提示

## PR 说明

- 个人工作台：桌面布局收紧留白与装饰，统一标题、卡片、日历控制区和分区入口，保留手机原有列表及折叠结构
- 统一“新增安排”入口：普通事件、独立个人 DDL、手动固定课程/旁听；课程每周或隔周重复 1–32 次，校验完整时间、整批事务写入、重复提交拦截和全周期冲突提示
- Max 自动识别上限从 3 个扩到 5 个独立事件，可混合普通事件与 DDL；逐项编辑、单独确认或全部确认，已确认卡片移除，其余未保存编辑不丢失
- 课程同步补读独立的时间地点接口，兼容清华大节列表及不同课时地点；请求限制与会话隔离仍保留，成功空结果与失败结果分开处理
- 新旧课程名解码常见 HTML 实体；课程公告最新优先，未知时间置后，桌面公告区跟随左侧课程列表高度并独立滚动
- 日历默认定位今天，“今天”按钮可重新定位；以周三与周日回归，避免周一假阳性
- 羊的染坊增加可撤销的“恢复原色”，沿用保存/版本校验机制；学习背景按钮取消箭头，与暂停漫步按钮右对齐
- 牧场入口：不带 UID 的 `/ranch` 等待登录状态确认后进入自己的牧场；显式指定的他人 UID 不变，游客、校验失败及无效 UID 分别提示
- 实验室：卡片与编辑器上方明确标出实际引擎及兼容范围，运行状态和环境说明分开显示
- C / C++ 使用 GCC，执行目标是 x86-64，MIPS32 / RISC-V64 仅生成汇编
- Python 使用 CPython，不继承用户电脑的第三方库
- 原 MATLAB 标签统一为 Octave（MATLAB 兼容），明确不是 MathWorks MATLAB、不包含其专有工具箱、不保证全部语法及结果一致
- Verilog 使用 Icarus Verilog / vvp，支持部分 SystemVerilog 2012，不包含 FPGA 综合及硬件执行
- 展示服务器端执行、无网络、临时文件、资源限制、公开分享边界及版本随部署变化的说明
- 保留 `language=matlab`、快照格式、草稿键、运行 API 和现有引擎实现，兼容已保存的链接与数据

## 许可核查状态（请保留在 PR 描述中）

本 PR 只增加准确的运行环境提示，不是合规认证，也没有解决或豁免第三方许可义务

GCC、CPython、GNU Octave 和 Icarus Verilog 均有公开许可，仍需遵守各自的使用及分发条件

当前 Dockerfile 安装了 Ghostscript，Octave 绘图调用 `gnuplot` 与 `print(..., '-dpng', ...)`；Ghostscript 的许可适配仍待核实

尚未取得生产镜像的准确版本清单及相应授权处理记录，不能将代码检查、CI 通过或新增提示描述为“生产环境已确认合规”

后续由部署负责人提供镜像标识、依赖及许可证清单、源码提供或商业授权材料，结合实际集成方式确认适用义务；必要时交由学校法务或权利方核实

本 PR 不更改全站 MIT 许可、不购买授权、不替换或下线运行引擎，也不部署生产服务；环境信息提示不代替上述核查

参考：[GCC 运行库许可](https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html)、[Python 许可](https://docs.python.org/3.12/license.html)、[Octave 许可](https://octave.org/copyright/)、[Icarus Verilog 源码许可](https://github.com/steveicarus/iverilog/blob/master/main.cc)、[Artifex 许可说明](https://artifex.com/licensing)

## 回归检查

- `node --test scripts/code-lab.test.js scripts/lab-results.test.js backend/language-lab.test.js`
- `node scripts/check-lab-environment-browser.js`：本地模拟 API，仅检查展示与交互，不执行用户代码、不连接生产服务
- `node scripts/check-workbench-elegant-browser.js`：本地模拟账号，检查布局、导引、日程表单与牧场入口，不使用真实账号、AI 或网络学堂

浏览器脚本需要 `PUPPETEER_MODULE` 和 Chrome 路径配置；实际引擎集成测试仍使用现有 `scripts/check-code-lab-browser.js`，不应将模拟展示测试等同于真实容器测试

### 本地验证结果（2026-09-28）

- `scripts/*.test.js`：1,137 项通过，0 失败、0 跳过
- `npm run test:workbench`：143 项通过，0 失败、0 跳过
- 运行环境、结果展示、语言 API 与牧场入口专项：29 项通过
- 运行环境浏览器回归：五种语言直达及切换，1440 / 390 / 320 px、明暗模式、两种字号与字体，共 60 组提示显示检查通过；服务不可用、503 错误及旧 `matlab` 快照通过
- 工作台浏览器回归：1600 / 1024 / 901 / 390 / 320 px 的 20 组明暗及字号组合通过；桌面时间图、手机列表、四步导引、日程新增、Max 两项预览确认和两个返回自己牧场的入口通过
- 原有日程卡片布局浏览器回归通过；预览配置最后调整后的 23 项相关单测通过
- 修改文件 Prettier 检查通过，ESLint 无错误（存在现有代码及测试 DOM 赋值警告），`git diff --check` 通过
- 未运行真实语言容器集成测试、未验证生产部署、未替换引擎或改变上线状态

### 本轮增量验证

- 新增 `scripts/check-workbench-arrangements-browser.js`：统一入口、个人 DDL、旁听课程、五事件混合、单项后全部确认不重复、保留未保存编辑、公告倒序/等高滚动、手机表单、原色重置保存、牧场按钮对齐、周三与周日定位通过
- 原多事件与固定课程浏览器回归通过，桌面及手机导引回归通过
- 公告完整倒序及缺失/无效发布时间置后通过；工作台导引已同步五事件、混合 DDL 与单项/全部确认文案
- 网络学堂采用合成响应验证，不使用真实账号；上线后需用户重新同步，以实际完整时间地点验收
- 本 PR 无数据库结构迁移，手动课程与 DDL 复用用户私有日程表；固定课程暂逐次编辑/删除，不提供整组编辑，调停课需用户核对
- 课程接口依据：[thu-learn-lib 的时间地点读取](https://github.com/Harry-Chen/thu-learn-lib/blob/master/src/index.ts)及[固定接口定义](https://github.com/Harry-Chen/thu-learn-lib/blob/master/src/urls.ts)，未复制其实现或引入该库

本地模拟预览：`http://127.0.0.1:3140/workbench`、`http://127.0.0.1:3140/code-lab?language=matlab`；使用内存中的模拟账号，不连接生产服务，代码实验室仅预览界面，不提供真实代码执行
