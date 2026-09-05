# 知识点正文：思源宋体简体中文

本目录仅为知识点正文自托管 Adobe 官方思源宋体的 Regular 400 和 Bold 700，
用于真实区分普通文字和课程原文的语义强调。标题、界面字体、公式及代码不由本目录规定。

## 来源与许可

- 上游：[Adobe Fonts / Source Han Serif](https://github.com/adobe-fonts/source-han-serif)。
- 版本：2.003；字体内部版本为 `Version 2.003;hotconv 1.1.1;makeotfexe 2.6.0`。
- 下载日期：2026-09-05。
- 使用官方 `SubsetOTF/CN` 中国地区完整子集，而非按照当前课程的少量文字裁剪。
- Adobe 将此地区子集的内部字体家族命名为 `Source Han Serif CN`；
  简体中文通常标记为 SC，本项目目录名不改变上游字体内部名称。
- 授权：SIL Open Font License 1.1，版权声明与完整许可证保留在 [LICENSE.txt](LICENSE.txt)。

实际下载地址（仅 Adobe 官方仓库）：

- [Regular OTF](https://raw.githubusercontent.com/adobe-fonts/source-han-serif/release/SubsetOTF/CN/SourceHanSerifCN-Regular.otf)
- [Bold OTF](https://raw.githubusercontent.com/adobe-fonts/source-han-serif/release/SubsetOTF/CN/SourceHanSerifCN-Bold.otf)
- [官方许可证](https://raw.githubusercontent.com/adobe-fonts/source-han-serif/release/LICENSE.txt)
- [2.003R 发布标签](https://github.com/adobe-fonts/source-han-serif/releases/tag/2.003R)

`release` 分支可能随上游版本更新；已另从固定 `2.003R` 标签下载并确认两份字体及许可证
与本目录的 SHA-256 一致。重新下载时必须核对以下 SHA-256，不能仅根据文件名覆盖。

## 实际文件核验

| 文件                           | 字重          |   字节数 | 字形数 | Unicode 码点数 |
| ------------------------------ | ------------- | -------: | -----: | -------------: |
| `SourceHanSerifCN-Regular.otf` | 400 / Regular | 11626108 |  31058 |          30930 |
| `SourceHanSerifCN-Bold.otf`    | 700 / Bold    | 12094680 |  31058 |          30930 |

两个文件均为官方静态 OpenType/CFF（`OTTO`），保留相同的 `Source Han Serif CN` 家族，
`OS/2.usWeightClass` 分别为 400、700；不是浏览器合成加粗，也没有可变字体的 `fvar` 表。
Unicode 码点数为字体 Unicode `cmap` 映射中的不同码点数量，不含格式 14 的变体序列计数。
两份字体均完整保留官方地区子集；不在该子集的罕见字符应由页面后备字体处理。

SHA-256：

```text
3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d  SourceHanSerifCN-Regular.otf
4ee555ae58b3d22f6a95c2c494f2c36b7cccfc1d2224635f6461a03756f0e3c1  SourceHanSerifCN-Bold.otf
9ff5bb567e1b92c801fc1069e5fbf992ff8efccacb9db94e5959a5b3ba9bb903  LICENSE.txt
```

## 保真与加载成本

未转码、未重命名内部家族、未改写字形、未裁剪字符，文件与以上官方下载结果逐字节一致。
当前官方发布目录提供静态 OTF 和可变 WOFF2，没有提供对应静态 CN Regular/Bold WOFF2；
本机没有现成可靠的 WOFF2 转换工具，因此优先保留官方原文件，不引入自制字体编码器或第三方下载源。

两份文件合计 23720788 字节（约 22.62 MiB）。页面应仅在需要知识点正文字体时按需加载，
使用 `font-display: swap`，并以同一家族的两个 `@font-face` 分别声明 400 和 700。
不要为全站页面预加载这两份大字体；生产环境应保留字体缓存策略。

## 重新下载与核验

在单独的临时目录执行以下 PowerShell 命令，再与上方的 SHA-256 对照。
命令只下载官方字体及许可证，不安装系统字体，也不操作项目 Git 远端。

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/SubsetOTF/CN/SourceHanSerifCN-Regular.otf' -OutFile 'SourceHanSerifCN-Regular.otf'
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/SubsetOTF/CN/SourceHanSerifCN-Bold.otf' -OutFile 'SourceHanSerifCN-Bold.otf'
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/LICENSE.txt' -OutFile 'LICENSE.txt'
Get-FileHash -Algorithm SHA256 -LiteralPath 'SourceHanSerifCN-Regular.otf', 'SourceHanSerifCN-Bold.otf', 'LICENSE.txt'
```

若未来改用 WOFF2，应使用可靠转换工具并重新核对字重、字形、完整字符覆盖与许可证条件，
同步记录转换工具版本、命令和新的文件哈希，而非仅修改文件后缀。
