# 电路编辑器 Max 助手

编辑器将本地未保存的电路、当前选择及最近一次仿真摘要发送给 Max。与课程页面一样，桌面端助手位于右侧；手机端通过助手入口打开。与已保存电路链接的读取功能不同，此接口无需先保存电路。

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

后端固定使用 Max 的 `general_chat`，避免导航路由丢失电路上下文，关闭流式响应和子代理执行。服务器补充引脚网络、元件目录及操作契约。模型回答中的单个 `circuit-actions` JSON 代码块被提取；普通 Markdown 作为 `answer` 返回：

```json
{
  "answer": "增大电阻会减小相同端电压下的电流。",
  "actions": [
    { "type": "set_parameter", "componentId": "R1", "parameter": "resistance", "value": 2000 },
    { "type": "highlight_components", "componentIds": ["R1"] }
  ]
}
```

非法、未闭合、重复代码块或任何无效操作会使整批 `actions` 变为空数组，并附上 `actionWarning`。代码块不显示为聊天正文。输入错误返回 400，未登录返回 401，上游服务失败或响应过大返回 502。结果不缓存。

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

编辑按数组顺序校验，每一步必须有效。例如删除参数扫描的目标前，应先将分析切换到直流工作点。高亮或波形的目标在整批结束后也必须仍存在。新建元件可以被后续连线引用。未运行仿真时不能建议不存在的波形，只能先建议运行；运行完成后再次提问即可获得结果。

`public/circuit-ai-actions.js` 在 Node 中导出 CommonJS，在浏览器导出 `window.CircuitAIActions`：

- `validateActions(actions, document, availableTraceIds=[])`：返回独立克隆的已校验操作数组；失败抛出可读错误。
- `applyActions(document, actions)`：再次校验并返回独立的新文档，不修改输入。显示、波形和运行操作不在此纯函数执行。调用方先使用真实波形 ID 调用 `validateActions`。
- `describeAction(action)`、`isEditingAction(action)`：供操作审阅列表使用。
- `validateEditorDocument(document)`：引擎校验与严格字段校验的组合。

前端将当前文档版本与建议绑定；生成建议后若用户编辑、撤销或换图，应重新提问。用户点击应用后，所有草稿修改作为一个批次应用，并可撤销；高亮、波形选择和本地仿真由编辑器桥接执行。不会执行模型提供的代码、请求、文件操作或持久化，也不自动保存电路或发布帖子。

测试：`node --test scripts/circuit-ai-actions.test.js backend/circuit-assistant.test.js`。覆盖真实电路仿真、原子修改、镜像/旋转、逐步校验、缺失和过期目标、未知字段及危险键、表达式解析、请求边界和实际 HTTP 路由。
