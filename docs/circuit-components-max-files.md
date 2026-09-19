# 元件、附件与手机布局

元件通过“添加”或 I 键打开分类菜单；输入框中的 I 不触发菜单，Esc 关闭。

- 方波源使用脉冲模型，默认 0–5 V、1 kHz、50% 占空比。
- 噪声源为可复现、均匀分布的采样保持噪声，频率决定更新速率，幅度为正负峰值；直流分析只计算偏置。
- 压控开关比较控制正、负端之间的电压与阈值，切换导通／关断电阻。
- 组合逻辑芯片有 A、B、Y、GND 四个引脚；支持 AND、OR、NOT、NAND、NOR、XOR、XNOR、BUF。NOT／BUF 仅使用 A。模型具有有限输出电阻，阈值附近用连续过渡保证级联求解。用于简单组合逻辑，不模拟时序延迟。
- 灯泡采用固定电阻模型，亮度按端电压与额定电压比值的平方计算；点亮时整页显示暖光，移除灯泡或失效的仿真结果会清除暖光。
- LED 采用二极管模型，亮度按正向电流相对额定电流计算，应外接限流电阻。
- 线电压采用青色正、橙色负，亮度表示相对于当前帧最大电压的大小。

问问 Max 支持粘贴、拖入、选择图片；添加时自动选择视觉模型，有图片时禁用非视觉选项。服务端仍拒绝把图片发送给不支持视觉的模型。

文件支持 doc/docx、xls/xlsx、ppt/pptx、pdf、md、txt，每个最多 10 MB，最多 4 个，合计文字不超过 6 万字。Excel 每表最多 3000 行，超过限制明确拒绝，避免默默丢失数据。解析在限时 worker 中进行，内容随消息进入对话记录；不保存原始二进制文件。只提取文字及表格值，不提取内嵌图片和排版。扫描版 PDF 若无文字，会提示改用图片发送。

手机顶部的操作和余额合为一行，正文顶部预留从 184px 减少到 128px。

PPT 解析依据 Microsoft [TextCharsAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a3c5c8d5-e530-4167-a242-7743bc99aeac) 和 [TextBytesAtom](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/80aae34b-2699-43fa-9e6a-c560ae790cd7) 定义。SheetJS 使用[官方安装文档](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)提供的 0.20.3 包。
