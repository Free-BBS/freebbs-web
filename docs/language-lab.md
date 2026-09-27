# 代码实验室

入口 `/code-lab?language=cpp|c|python|matlab|verilog`，实验室目录 `/laboratory`。

- C17 / C++17：GCC 原生 x86-64 编译运行，MIPS32 与 RISC-V64 交叉编译汇编，包含对应标准库头文件。支持 -O0/1/2/3/s，汇编 `.loc` 点击定位源码。MIPS 和 RISC-V 仅生成汇编，不运行目标程序。
- Python：CPython `sys.settrace` 在执行每行前发送变量快照，包含全局/局部作用域、类型、值、函数及行号。0–5 秒行间隔作用于实际执行；支持暂停、继续、单步、停止和运行中调速。值观察不调用自定义 `__repr__`。不是预先运行后动画回放。
- MATLAB：使用 GNU Octave 兼容语法，非 MathWorks MATLAB。保留真实 `plot`、`subplot`、图例及多图输出，最多六张 PNG；不承诺 MATLAB 专有工具箱兼容。
- Verilog：Icarus Verilog `-g2012` 编译，vvp 仿真；自动插入独立 VCD 采集模块，可解析总线、别名和 X/Z 状态。支持缩放、信号筛选和时间游标，最多 40 路信号、每路 2000 个跳变。用户测试平台应调用 `$finish`。

所有语言支持 stdin、编译/运行错误、退出码、按账号/语言保存浏览器草稿、源码下载。

## 发布与预览

“分享到讨论区”首先在 `code_experiments` 保存公开且不可变的快照，再进入现有 `/publish` 页面选择版块、编辑正文并发布。原有帖子草稿会保留并追加实验引用；不会自动发布测试帖子。

`/code-lab?experiment=e_<32hex>` 固定指向该快照，保存源码、输入、语言参数及已完成运行的结果。后端只接受当前用户的运行凭据，校验源码/输入/参数一致性；已修改代码或过期凭据须重新运行。也允许明确的“仅代码”快照。凭据在进程内保存 30 分钟，最多 40 份；已发布快照存入 MySQL，服务重启后仍可读取。新表首次保存/读取时按现有建表模式幂等创建，无现有数据迁移。

讨论区列表根据语言显示汇编片段、变量表或波形/绘图缩略图，正文内显示结果卡片，保留打开完整实验的链接。预览不执行源代码。分享快照本身公开，与帖子是否仅登录可见是独立的；入口在分享前明确告知。结果中的文本全部转义，绘图仅允许 PNG data URL，不允许作者 HTML/SVG。

## 隔离架构与部署

浏览器 → 已登录后端 `/api/labs` → `127.0.0.1:8010` 专用 Docker broker → 单次无网络 worker。

Web 后端不访问 Docker socket，也不直接执行源码。broker 仅绑定主机回环端口，属于受信任的运维服务，需要 Docker 权限；不可公开 8010。worker 不挂载主机目录或凭据，非 root，只读根文件系统，96 MiB tmpfs，512 MiB 内存，1 CPU，64 进程，CPU/文件/输出限制，180 秒独立容器内硬超时。每用户最多一个运行，全站最多四个。取消、浏览器断开或超时均清理容器。长时间 Python 暂停时后端每 10 秒保持连接。

在 Linux 应用服务器以有 Docker 权限的部署账号运行：

```sh
bash scripts/deploy-language-lab.sh
curl --fail http://127.0.0.1:8010/health
python3 services/language-lab/integration_test.py
```

安装脚本构建 `freebbs-language-lab:latest`，先检查全部编译器，再启动受回环网络限制的 `freebbs-language-lab-controller`（restart unless-stopped）。部署 worker/broker 修改时也需执行此脚本；日常 Web 部署保持原 GitHub Actions 流程。可以通过 `LAB_IMAGE` 使用版本标签；后端 `LANGUAGE_LAB_URL` 默认本机 8010，可配置到独立受信任执行节点。运行服务不可用时返回就绪状态，编辑和代码快照仍可用，不影响原 `/api/code/run` 或其他页面。

验证：

```sh
npm run test:code-lab
npm run test:discussion-markdown
python3 services/language-lab/test_worker.py
# 必须先有本机 broker：真实 C/C++、Python、Octave、Verilog 与隔离/终止测试
python3 services/language-lab/integration_test.py
# 独立的本地账号/快照/帖子；执行可用 SSH 转发连接到隔离 broker
LANGUAGE_LAB_URL=http://127.0.0.1:18010 node scripts/preview-language-lab.js
```

参考：[Python tracing](https://docs.python.org/3/library/sys.html#sys.settrace)、[Octave 图像导出](https://docs.octave.org/latest/Printing-and-Saving-Plots.html)。
