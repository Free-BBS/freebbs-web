# 电路编辑器 Max 助手

编辑器默认以“自主执行”模式将本地未保存的电路、当前选择及最近一次仿真摘要发送给 Max。Max 选择操作，浏览器执行并等待结果，然后把新快照和执行结果送回模型，直到完成或停止。“仅给建议”保留原有点选应用方式。与课程页面一样，桌面端助手位于右侧；手机端通过助手入口打开。与已保存电路链接的读取功能不同，此接口无需先保存电路。

右侧栏有“Max”和“元件参数”两个标签，切换时保留对话和输入。完整元件参数、旋转/镜像及连接操作集中在参数标签中。选中元件时，画布旁显示可编辑参数浮层；它与侧栏共用字段定义、校验和草稿更新逻辑，修改任一入口都会同步。键盘选中会聚焦参数，Esc 或关闭按钮返回元件；浮层的“在侧栏查看”打开完整参数。手机从侧栏开始连线时会收起抽屉，让画布继续接收操作。

## 请求与响应

登录用户通过 `POST /api/ai/circuit/chat` 发送：

```json
{
  "question": "把 R1 改为 2kΩ，并标出相关元件",
  "document": {
    "version": 1,
    "components": [
      { "id": "R1", "type": "resistor", "x": 200, "y": 160, "params": { "resistance": 1000 } }
    ],
    "wires": [],
    "analysis": { "type": "dc" }
  },
  "selection": { "componentId": "R1" },
  "history": [],
  "simulation": null
}
```

`question` 最多 4000 字符。`history` 最多 12 条 `user` / `assistant` 消息，每条最多 4000 字符。`selection` 可含 `componentId` / `wireId`，都必须存在于当前快照。文档最多 256 KiB，完整请求最多 512 KiB。元件、引脚、参数、坐标、分析及拐点沿用电路引擎的校验，接口额外拒绝未知字段。

可选 `simulation` 形如 `{analysis,sampleCount,warnings,traces:[{id,label,unit,min,max,latest,samples:[{x,value}]}]}`。最多 24 条真实波形、每条最多 64 个稀疏采样点、20 条提示。没有有效仿真时传 `null`。服务器不运行仿真，也不把用户传来的结果称作独立验证过的计算。原始全部采样和帧不发送给模型。

后端固定使用 Max 的 `general_chat`，避免导航路由丢失电路上下文，关闭流式响应和子代理执行。服务器补充引脚网络、元件目录及操作契约。模型回答中的单个 `circuit-actions` JSON 操作块被提取，也兼容普通 `json`、无标签代码块以及独立的裸 JSON 操作对象。所有格式都必须包含顶层 `actions` 并经过相同的严格操作校验；普通 Markdown 和非操作 JSON 保留为 `answer`：

```json
{
  "answer": "增大电阻会减小相同端电压下的电流。",
  "actions": [
    { "type": "set_parameter", "componentId": "R1", "parameter": "resistance", "value": 2000 },
    { "type": "highlight_components", "componentIds": ["R1"] }
  ]
}
```

非法、未闭合、重复操作块或任何无效操作会使整批 `actions` 变为空数组，并附上 `actionWarning`。操作 JSON 不显示为聊天正文；不会把数组内的示例对象或 JSON 后接代码的前缀作为操作执行。输入错误返回 400，未登录返回 401，上游服务失败或响应过大返回 502。结果不缓存。

## 声明式操作

每批最多 12 项，只允许以下操作；对象不能携带额外字段：

| type                   | 字段                                                           | 效果                                 |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `highlight_components` | `componentIds: string[]`                                       | 高亮元件；空数组清除                 |
| `show_traces`          | `traceIds: string[]`                                           | 显示并强调实际存在的波形；空数组隐藏 |
| `set_parameter`        | `componentId, parameter, value`                                | 修改目录中已有参数，采用 SI 单位     |
| `set_analysis`         | `analysis`                                                     | 设置引擎支持的分析                   |
| `add_component`        | `component: {id,type,x,y,rotation?,mirrorX?,mirrorY?,params?}` | 添加元件                             |
| `connect`              | `from, to, points?`                                            | 连接已存在引脚，自动分配唯一导线 ID  |
| `transform_component`  | `componentId, rotation?, mirrorX?, mirrorY?`                   | 设置绝对旋转/镜像，至少一个变换字段  |
| `move_component`       | `componentId, x, y`                                            | 修改画布位置                         |
| `delete_component`     | `componentId`                                                  | 删除元件与关联导线                   |
| `run_simulation`       | 无                                                             | 在浏览器运行当前草稿                 |

编辑按数组顺序校验，每一步必须有效。例如删除参数扫描的目标前，应先将分析切换到直流工作点。高亮或波形的目标在整批结束后也必须仍存在。新建元件可以被后续连线引用。未运行仿真时不能建议不存在的波形，只能先建议运行；自主执行时，运行完成后自动把实际计算结果送入下一次决策；仅给建议时，运行完成后再次提问即可获得结果。

`public/circuit-ai-actions.js` 在 Node 中导出 CommonJS，在浏览器导出 `window.CircuitAIActions`：

- `validateActions(actions, document, availableTraceIds=[])`：返回独立克隆的已校验操作数组；失败抛出可读错误。
- `applyActions(document, actions)`：再次校验并返回独立的新文档，不修改输入。显示、波形和运行操作不在此纯函数执行。调用方先使用真实波形 ID 调用 `validateActions`。
- `describeAction(action)`、`isEditingAction(action)`：供操作审阅列表使用。
- `validateEditorDocument(document)`：引擎校验与严格字段校验的组合。

前端将当前文档版本与操作绑定；自主执行中如果用户编辑、撤销、换图或切换登录状态，旧快照不能继续应用。每批操作先完整校验，再由编辑器执行；本地仿真返回实际完成、错误或超时后才进入下一轮。模型不能调用任意代码、请求、文件操作或持久化，也不自动保存电路或发布帖子。

测试：`node --test scripts/circuit-ai-actions.test.js backend/circuit-assistant.test.js`。覆盖真实电路仿真、原子修改、镜像/旋转、逐步校验、缺失和过期目标、未知字段及危险键、表达式解析、请求边界和实际 HTTP 路由。

## 自主执行协议

`POST /api/ai/circuit/chat` 可额外携带：

```json
{
  "agent": {
    "step": 2,
    "canEdit": true,
    "observations": [
      {
        "step": 1,
        "status": "success",
        "summary": "已修改参数并完成仿真；本次快照包含新的实际结果。"
      }
    ]
  }
}
```

`step` 为 1–12，`observations` 最多 11 项，只包含严格递增的先前步骤；每项状态为 `success` 或 `error`，摘要最多 4000 字符。原始用户任务和最近对话保持不变；每轮重新读取完整草稿、图像设置和真实仿真摘要。执行失败时，错误与当前仍有效的草稿一起返回，模型可修正后重试。模型文本和观察摘要都是数据，不能替代当前结果，也不会被当成代码执行。

自主执行的响应额外包含 `done`：有操作时为 `false`，完成回答且无操作时为 `true`。模型可以在 `circuit-actions` 块中使用 `{"actions":[],"done":true}` 结束，也可直接给出没有操作块的最终回答。无效批次保留 `actionWarning` 且 `done:false`，前端将校验错误送回下一轮；不会将无效操作误报为完成。前端仅在接口明确返回 `done:true`、无操作且结论非空时结束，空操作但未完成或缺少完成状态的响应会要求下一轮修正。只读上下文允许解释、高亮、查看和仿真，禁止修改草稿。

`public/circuit-agent.js` 负责有限循环、停止、超时、快照版本检查及执行观察。每轮最多 12 次模型决策，总计最多 10 分钟；连续 3 次失败、重复没有进展的操作或手动改动画布时结束。停止会取消请求及关联仿真，迟到的响应不能继续执行。侧栏逐步显示操作状态，收起侧栏仍可停止。每轮的修改由编辑器保存一个整体撤销点，结束后可恢复运行前状态；后续手动编辑后，旧撤销点不能覆盖新修改。

可执行工具包括元件参数、分析方式、元件增删和连线、位置与变换、高亮与仿真，以及 `set_plot`（公式、通道、X–T/X–Y、相位和坐标范围）、`set_annotation` / `delete_annotation`。图像操作沿用真实采样与安全数学表达式校验；新数学曲线的极值须在执行后的下一轮读取，不能凭空生成。

## 长请求与错误反馈

电路助手可能需要较长时间完成一轮推理。接口在等待期间每 15 秒发送合法 JSON 空白，并设置 `X-Accel-Buffering: no`，让代理持续收到数据；客户端仍按普通 JSON 读取完整结果。每次请求最多 150 秒，超时会取消上游模型调用，用户停止或离开页面也会取消请求。

如果保活已经发送 HTTP 200 响应头，后续错误通过 `{ok:false,status:502|504,message,detail?,code}` 返回；客户端按此状态处理失败。保活之前的错误使用相应 HTTP 状态。代理返回 HTML 错误时，页面会给出状态对应的具体提示，例如服务器等待超时，而不只显示“请求失败”。
