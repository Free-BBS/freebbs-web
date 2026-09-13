# 电路仿真数据与模块约定

## 电路文档

`{version:1, components:[], wires:[], analysis:{type:'transient', stop:0.01, step:0.00001, initial:'zero'}}`

元件：`{id:'R1', type:'resistor', x:240, y:160, rotation:0, params:{resistance:1000}}`。
可选 `mirrorX`、`mirrorY` 为布尔值，分别翻转元件的局部 X、Y 坐标，先镜像再按 `rotation` 旋转；省略与 `false` 均表示不镜像，旧文档不会自动补入字段。符号、引脚、电流箭头和极性标识共享变换，引脚索引及电气连接不变。画布水平/竖直镜像在 90/270 度旋转时应交换局部镜像轴。元件名称、参数以及符号内的文字保持正向可读，标注移至变换后的符号及引脚外侧。
编辑器连线交互：点击引脚拿起导线，点击空白画布按可见的 20 单位网格添加拐点，点击目标引脚或已有导线完成；从引脚拖到空白处松开也会进入此模式。预览和提交使用同一吸附规则，水平/竖直导线分支沿线吸附，非格点引脚、已有角点及斜线保持精确位置。Backspace、⌘/Ctrl+Z 或“撤回拐点”撤回末点，Esc 取消。完成前仅显示草稿，连接确认后才提交导线及中间连接点；没有拐点的新线显式保存 `points: []`。已选线段可拖动并自动添加必要拐点，端点仍由引脚确定。撤销/重做记录仅在当前编辑页面内保存，不写入共享电路文档。

导线：`{id:'w1', from:{componentId:'R1',pin:0}, to:{componentId:'V1',pin:0}, points:[{x:300,y:160}]}`。可选 `points` 只存中间拐点，最多32个；省略时自动正交走线，显式空数组表示直线。端点由引脚确定，移动元件不会改变拐点坐标。pin 为从0开始的索引。导线端点均为引脚，导线中途接线通过 junction 元件表示：目标导线分成两段并共用该连接点。普通交叉不产生连接。所有 ground 的引脚为同一零电位。坐标以画布 SVG viewBox 为准，rotation 为 0/90/180/270。最多80元件、200导线。

类型和引脚顺序：

- junction: [连接点]，params={}，引脚位于元件坐标原点，无支路和独立测量通道。
- ground: [地]
- vcc / vdd / vss / vee: 单引脚网络符号，同类型在当前文档内合并网络，不指定电压、不自动接地；无参数。
- fixed_voltage: [电平]，唯一参数 dc（默认 5 V），理想直流电源相对隐含参考地；AC 幅值为 0。
- resistor, capacitor, inductor, voltage, current, diode, nonlinear, voltmeter, ammeter, oscilloscope: [正,负]；二极管正端为阳极。
- vcvs, vccs: [输出正,输出负,控制正,控制负]
- ccvs, cccs: [输出正,输出负]；params.control 为电压源或电流表元件 ID，对应该元件正端流向负端的电流。
- bjt: [集电极,基极,发射极]，params.polarity 为 npn/pnp。
- mosfet: [漏极,栅极,源极]，params.polarity 为 n/p，体端与源极相连。
- opamp: [正输入,负输入,输出]；输出电压相对地，参数指定正负限幅。

参数名：resistance(Ω), capacitance(F), inductance(H), dc(V或A), waveform(dc/sine/pulse), amplitude, frequency(Hz), phase(度), duty(0–1), delay(s), acAmplitude, gain(受控源), control(电流控制元件ID), is(二极管/BJT反向饱和电流), n(二极管理想因子), beta(BJT正向β), betaReverse, thermalVoltage, kp(MOS A/V²), w, l(均m), vto(V), lambda(1/V), polarity, railPositive/railNegative(运放电源限幅), expression(例如i=k*u^3), k(自定义特性常数)。非线性公式只接受安全数学解析，不执行 JavaScript。

## 仿真引擎

`public/circuit-engine.js` 同时支持 CommonJS 和 `window.FreeBbsCircuitEngine`。

- `catalog`: 以 type 为键的 `{label,pins:[文字],defaults:{...}}` 元件目录。
- `validateDocument(document)`: 无效时 throw（中文可读信息），有效时返回标准化文档。
- `simulate(document, options=document.analysis)`: 返回下述结果，失败 throw（禁止伪造0曲线）。
- `sourceAnalysisAdvice(document, options=document.analysis)`: 返回 `{warnings, suggestedAnalysis}`，指出周期源采样不足或分析模式不适用；建议不修改原文档。
- `limits`: 瞬态与扫描的采样点上限。
- `buildNets(document)`: 返回 `{pinNets:{'R1:0':'n1',...}, nets:[...], ground:'0'}`，用于示意图电压着色。

分析：`{type:'dc'}`；`{type:'transient',stop,step,initial:'zero'|'operating-point'}`；`{type:'sweep',componentId:'V1',parameter:'dc',start:0,stop:5,points:101}`；`{type:'ac',start:10,stop:1e5,points:101,scale:'log'|'linear'}`。扫描参数也支持 beta、w、l、k 等数值参数。瞬态最多100001点，参数和AC扫描最多2000点，非收敛/浮空/非法公式须可读报错。

结果：`{analysis, x:[], xLabel, xUnit, traces:[{id,label,unit,values:[],phase?:[]}], frames:[{voltages:{net:value},currents:{componentId:value}}], warnings:[]}`。每个元件都有 `V:<id>`（正负引脚压差；晶体管取首末引脚）和 `I:<id>` 的 trace，ground、junction 和电源网络符号除外。AC values 为幅值，phase为角度；frames可以只包含直流工作点，动态图只播放时域帧。仪表无独立电流量测时为理想开路，电流表串接0V源。所有值必须有限。

电流动画与 `I:<id>` 的符号一致：两端元件正向为 pin 0→1，BJT 为集电极→发射极，MOS 为漏极→源极；运放正向为流入输出端的支路电流（输出端→内部参考地）。负值同时反转流动路径和箭头。旋转、镜像只改变这些方向在画布上的朝向，不改变仿真读数；独立电流源符号内箭头表示参数的正参考方向，实际负电流由动画反向表示。

工作线程 `public/circuit-worker.js` 接收 `{id,document,options}` 并发送 `{id,result}` 或 `{id,error}`；主线程可terminate取消。

## 保存接口

`/api/circuits`：登录用户 POST `{title,description,document}` 创建；GET `?mine=1` 列出自己的电路。`GET /api/circuits/:cid?revision=N` 公开读取指定/最新版本；PUT 仅作者或管理员 `{title,description,document,expectedRevision}` 保存，新版本自增，冲突409。CID为 `c_` + 24位小写十六进制；revision为正整数。每次版本保留内容快照，引用既有版本不随修改改变。

响应 `{circuit:{cid,title,description,document,revision,owner:{uid,username},canEdit,createdAt,updatedAt}}`；列表 `{circuits:[摘要]}`。

页面 `/circuit?cid=...` 编辑/查看，`/circuits`个人列表与新建入口；可同一HTML通过路径区分。嵌入 `/circuit-embed?cid=...&revision=1&view=live|waveform|schematic`。

## 示例与发帖

公开 `GET /api/circuit-examples` 返回 `{examples:[{id,title,description,revision}],canManage}`；`GET /:id` 返回 `{example:{id,title,description,revision,document}}`。管理员 POST `{title,description,document}` 添加；PUT `/:id` 加 `expectedRevision` 更新，DELETE `/:id` 携带 `{expectedRevision}` 删除。修改/删除旧版本返回409，已删示例返回404。种子示例通过唯一 seed_key 和软删除状态保证重启不覆盖修改、不恢复删除。

`/discussion?board=circuit&compose=circuit&cid=...&revision=N` 表示打开电路发帖草稿。讨论页验证固定版本存在后预填默认标题、分区与 Markdown 引用，只打开编辑器，不自动发帖。

## Markdown引用

`[电路动态图](/circuit?cid=c_0123456789abcdef01234567&revision=1&view=live)`

使用正常 Markdown 链接承载电路引用，view可为live、waveform、schematic。阅读时识别本站 /circuit 链接并增强为嵌入图；代码块内不增强。普通 /circuit?cid= 链接保留普通链接。只有合法CID、正整数revision和白名单view才嵌入。

## 模型范围

本次使用浏览器内数值求解的教学模型：MNA、非线性迭代、二极管Shockley、BJT Ebers–Moll、MOS长沟道平方律、有限增益/限幅运放。直流工作点、瞬态、直流/元件参数扫描及工作点线性化AC。参数使用SI单位。模型说明须明确不等于完整工艺SPICE模型，并给出数值限制。

非线性直流工作点先尝试 Newton 迭代和电源步进；若零初值使 MOS 全部截止、初始矩阵不可解，再逐步撤去临时节点对地电导（1e-3 至 1e-12 S）寻找启动初值。电导在对数尺度上自适应步进：失败时减半步长，通过后逐渐增大，最多尝试 64 次，避免在晶体管工作区交界处跨步过大。这沿用 [SPICE 电导步进的收敛思路](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf)，但返回结果前必须完全移除临时电导，并重新求解原始方程、检查残差及电压/电流修正量。不会把临时漏电纳入仪表、波形或 AC 线性化；真实浮空节点和理想电源冲突仍报错。参数扫描、AC 和采用工作点初始条件的瞬态共享此启动方式。

参考：ngspice 用户手册（https://ngspice.sourceforge.io/docs/ngspice-manual.pdf），用于模型及分析语义的依据，不将本实现称为ngspice。
