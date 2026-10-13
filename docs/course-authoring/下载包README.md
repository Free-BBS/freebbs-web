# FREE BBS 课程组 Markdown 提交与发布包

完整使用说明见 [README](docs/course-authoring/README.md)，内容编写要求见 [课程组编写指南](docs/course-authoring/课程组编写指南.md)。模板、样例和工具都在 `docs/course-authoring/`。

每个知识点只交一份完整 MD；基本信息、概览与知识起源、正文与题目分成三个固定分区。每章使用实际名称。不要把学生的私人笔记、作答、聊天、账号密码或 Token 放进课程稿。

## 下载已有稿件

先在官网“个人设置 → 课程组 Agent 接入”生成个人 Token，由管理员分配负责课程。通过安全环境配置设置 `FREEBBS_BASE_URL=https://www.free-bbs.cn` 和 `FREEBBS_UPLOAD_TOKEN`，不要把 Token 放进命令参数或提交包。

安装 Node.js 后，在 `docs/course-authoring/` 目录执行：

```sh
node tools/下载课程.cjs signals --out 现有信号课程
```

`signals` 换成自己负责的课程标识，输出目录必须不存在。这会只读保存地图、节点 JSON、三个 MD 分区和 revision，保留作者评分配置；不读取学生记录，也不下载图片和附件本体。公开阅读快照不能代替完整作者备份。

## 上传已审核的完整模板

保留旧稿，在模板中填好真实章名、起源、署名、题目及必要评分规则；格式检查不代替教学审核。先从下载结果中取得要更新节点的旧 revision，在同一目录执行：

```sh
node tools/上传知识点.cjs "课程包/知识点/SS-01-01.md" --revision "此前读取的64位revision"
```

默认只校验和读取网站，不写入。确认课程、节点、修改范围及审核结果后，在同一命令末尾追加 `--publish`，才会单次发布并回读验证。

新节点使用 `--revision new --x 200 --y 180`，坐标应由课程组确认；更新不传坐标就保留原位置。遇到权限错误、版本冲突或写入结果不确定时停止，先回读核对，不盲目重传。

上传成功后正文会公开可见，题目的 `draft` 状态不会隐藏整篇正文。普通 `upload-node` 只上传正文，不适合上传这份完整三分区模板。新工具的官网公共下载入口需 PR #180 对应版本部署后生效。
