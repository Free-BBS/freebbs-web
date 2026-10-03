import SwiftUI
import UniformTypeIdentifiers

struct NativeCodeLabView: View {
    @Environment(AppStore.self) private var store
    let destination: LabDestination
    @State private var lab: CodeLaboratory
    @State private var runTask: Task<Void, Never>?
    @State private var editor = false
    @State private var resultTab = "输出"
    @State private var assemblyTarget = "x86"
    @State private var draft: DiscussionDraft?
    @State private var export: LabExport?
    @State private var sharing = false
    @State private var confirmShare = false
    init(destination: LabDestination) {
        self.destination = destination
        let query = URLComponents(string: destination.path)?.queryItems
        let language = CodeLanguage(rawValue: query?.first(where: { $0.name == "language" })?.value ?? "cpp") ?? .cpp
        _lab = State(initialValue: CodeLaboratory(language: language))
    }
    var body: some View {
        @Bindable var lab = lab
        Form {
            Section {
                Picker("语言", selection: Binding(get: { lab.language }, set: { lab.reset($0) })) {
                    ForEach(CodeLanguage.allCases) { Text($0.name).tag($0) }
                }.disabled(lab.running)
                TextField("实验标题", text: $lab.title).disabled(lab.running)
                Button { editor = true } label: {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("编辑代码", systemImage: "curlybraces").font(.headline)
                        Text(lab.source.split(separator: "\n", omittingEmptySubsequences: false).prefix(7).joined(separator: "\n"))
                            .font(.system(.subheadline, design: .monospaced)).foregroundStyle(.secondary)
                            .lineLimit(7).frame(maxWidth: .infinity, alignment: .leading)
                        Text("\(lab.source.split(separator: "\n", omittingEmptySubsequences: false).count) 行").font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 6)
                }.accessibilityIdentifier("editLabSource")
            } header: { Text("代码") } footer: {
                if store.isDemo { Text("示例模式可编辑代码和参数；运行与公开分享需连接正式账户。") }
            }
            Section("运行参数") {
                TextField("标准输入（选填）", text: $lab.stdin, axis: .vertical).lineLimit(2...6).font(.system(.body, design: .monospaced)).disabled(lab.running)
                if lab.language == .c || lab.language == .cpp {
                    Picker("优化级别", selection: $lab.optimization) {
                        ForEach(["0", "1", "2", "3", "s"], id: \.self) { Text("-O" + $0).tag($0) }
                    }.disabled(lab.running)
                }
                if lab.language == .python {
                    Stepper("步进间隔 \(lab.interval, specifier: "%.1f") 秒", value: $lab.interval, in: 0...5, step: 0.1)
                        .onChange(of: lab.interval) { _, _ in if lab.running { Task { await lab.control("speed", api: store.api) } } }
                }
            }
            Section {
                Label(lab.status, systemImage: lab.running ? "clock" : "terminal").foregroundStyle(.secondary)
                if lab.running, lab.language == .python {
                    HStack {
                        Button(lab.paused ? "继续" : "暂停") { Task { await lab.control(lab.paused ? "resume" : "pause", api: store.api) } }
                        Spacer()
                        Button("下一步") { Task { await lab.control("step", api: store.api) } }.disabled(!lab.paused)
                    }.buttonStyle(.bordered)
                }
                if let error = lab.error { Text(error).foregroundStyle(.red) }
                if lab.running { ProgressView().accessibilityLabel("实验正在运行") }
                if !lab.console.isEmpty || lab.trace != nil || lab.output != nil {
                    Picker("结果", selection: $resultTab) {
                        Text("输出").tag("输出")
                        if lab.language == .python { Text("变量").tag("变量") }
                        if lab.language == .c || lab.language == .cpp { Text("汇编").tag("汇编") }
                        if lab.language == .matlab { Text("绘图").tag("绘图") }
                        if lab.language == .verilog { Text("波形").tag("波形") }
                    }.pickerStyle(.segmented)
                    resultContent
                }
            } header: { Text("结果") } footer: {
                Text(lab.language == .matlab ? "由 GNU Octave 执行 MATLAB 兼容代码。" : lab.language == .cpp || lab.language == .c ? "x86 执行代码；MIPS 与 RISC-V 用于汇编对比。" : "运行时间上限 180 秒。")
            }
        }.navigationTitle(lab.language.name + " 实验").navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {

                        Button("导出代码", systemImage: "square.and.arrow.up") { exportCode() }
                        Button("分享至讨论", systemImage: "bubble.left") { if requireAccount() { confirmShare = true } }.disabled(lab.running || sharing)
                        Button("恢复示例", systemImage: "arrow.counterclockwise") { lab.reset(lab.language) }.disabled(lab.running)
                    } label: { Image(systemName: "ellipsis") }.accessibilityLabel("实验操作")
                }
                ToolbarItem(placement: .bottomBar) {
                    if lab.running {
                        Button("停止", systemImage: "stop.fill") { runTask?.cancel() }.tint(.red)
                    } else {
                        Button("运行", systemImage: "play.fill") { start() }.disabled((!store.isDemo && !lab.ready) || lab.source.isEmpty || lab.source.utf8.count > 64000).accessibilityIdentifier("runLab")
                    }
                }
                if lab.language == .python {
                    ToolbarItem(placement: .bottomBar) { Button("逐步运行", systemImage: "forward.frame") { start(singleStep: true) }.disabled(lab.running || (!store.isDemo && !lab.ready)) }
                }
            }
            .sheet(isPresented: $editor) { NavigationStack { SourceEditor(title: lab.language.name, source: $lab.source, readOnly: lab.running, currentLine: lab.trace?.line) } }
            .sheet(item: $draft) { item in NavigationStack { ComposeView(title: item.title, content: item.content, board: item.board) }.environment(store) }
            .sheet(item: $export) { item in LabShareSheet(url: item.url) }
            .confirmationDialog("生成公开实验链接？", isPresented: $confirmShare, titleVisibility: .visible) {
                Button("生成链接并撰写讨论") { Task {
                    sharing = true; defer { sharing = false }
                    do { draft = try await lab.snapshot(api: store.api) } catch { lab.error = error.localizedDescription }
                } }
            } message: { Text("代码、输入参数和当前运行结果将保存为公开实验。你可以在下一步编辑讨论内容。") }
            .task { await load() }
            .onDisappear { runTask?.cancel() }
    }
    private var fullWorkspacePath: String {
        var components = URLComponents(string: destination.path)!
        components.queryItems = (components.queryItems ?? []).filter { $0.name != "language" } + [.init(name: "language", value: lab.language.rawValue)]
        return components.string ?? "/code-lab"
    }
    @ViewBuilder private var resultContent: some View {
        switch resultTab {
        case "变量":
            if let trace = lab.trace ?? lab.output?.lastTrace {
                Text("第 \(trace.line ?? 0) 行 · \(trace.function ?? "main") · 步骤 \(trace.step ?? 0)").font(.caption).foregroundStyle(.secondary)
                ForEach(Array((trace.variables ?? []).prefix(100))) { variable in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(variable.name + " · " + variable.type).font(.subheadline.bold())
                        Text(variable.value).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                    }
                }
            } else { Text("逐步运行后，变量会显示在这里。").foregroundStyle(.secondary) }
        case "汇编":
            Picker("架构", selection: $assemblyTarget) {
                Text("x86").tag("x86"); Text("MIPS").tag("mips"); Text("RISC-V").tag("riscv")
            }
            let assembly = lab.output?.assembly?[assemblyTarget]
            let assemblyText = assembly?.text ?? ""
            let assemblyError = assembly?.error ?? ""
            CodeResultText(text: !assemblyText.isEmpty ? assemblyText : !assemblyError.isEmpty ? assemblyError : "运行后可查看汇编。")
        case "绘图":
            let figures = Array((lab.output?.figures ?? []).prefix(6))
            ForEach(Array(figures.enumerated()), id: \.offset) { index, source in
                if let image = Self.figure(source) { Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("实验绘图 \(index + 1)") }
            }
            if figures.isEmpty { Text("使用 figure 和 plot 生成绘图。").foregroundStyle(.secondary) }
        case "波形":
            if let waveform = lab.output?.waveform { NativeWaveformView(waveform: waveform) }
            else { Text("运行仿真后可查看时序波形。").foregroundStyle(.secondary) }
        default: CodeResultText(text: lab.console.isEmpty ? "程序尚无输出。" : lab.console)
        }
    }
    static func figure(_ source: String) -> UIImage? {
        let prefix = "data:image/png;base64,"
        guard source.hasPrefix(prefix), source.utf8.count <= 330000,
              let data = Data(base64Encoded: String(source.dropFirst(prefix.count))) else { return nil }
        return UIImage(data: data)
    }
    private func requireAccount() -> Bool {
        guard !store.isDemo else { lab.error = "示例模式不会运行或公开线上实验。"; return false }
        guard store.api.token != nil else { store.showLogin = true; return false }
        return true
    }
    private func start(singleStep: Bool = false) {
        guard requireAccount() else { return }
        runTask = Task { await lab.run(api: store.api, singleStep: singleStep) }
    }
    private func load() async {
        guard !store.isDemo else { lab.status = "示例代码 · 可编辑预览"; return }
        do {
            let response: LabCapabilities = try await store.api.request("/api/labs/capabilities")
            lab.ready = response.ready; lab.status = response.ready ? "运行环境就绪" : "运行环境暂时不可用"
            if let id = URLComponents(string: destination.path)?.queryItems?.first(where: { $0.name == "experiment" })?.value,
               id.range(of: "^e_[a-f0-9]{32}$", options: .regularExpression) != nil {
                let saved: ExperimentResponse = try await store.api.request("/api/labs/experiments/" + id)
                if let language = CodeLanguage(rawValue: saved.experiment.language) { lab.reset(language) }
                lab.title = saved.experiment.title; lab.source = saved.experiment.source
                lab.stdin = saved.experiment.stdin ?? ""; lab.optimization = saved.experiment.optimization ?? "0"
                lab.interval = saved.experiment.interval ?? 1; lab.output = saved.experiment.result
                lab.console = [lab.output?.stdout ?? "", lab.output?.stderr ?? ""].filter { !$0.isEmpty }.joined(separator: "\n")
            }
        } catch { lab.error = error.localizedDescription }
    }
    private func exportCode() {
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("experiment." + lab.language.fileExtension)
            try lab.source.write(to: url, atomically: true, encoding: .utf8)
            export = LabExport(url: url)
        } catch { lab.error = error.localizedDescription }
    }
}

struct SourceEditor: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    @Binding var source: String
    var readOnly = false
    var currentLine: Int?
    @FocusState private var focused: Bool
    var body: some View {
        VStack(spacing: 0) {
            if let currentLine { Text("执行位置：第 \(currentLine) 行").font(.caption).foregroundStyle(.secondary).padding(8) }
            TextEditor(text: $source).font(.system(.body, design: .monospaced)).textInputAutocapitalization(.never)
                .autocorrectionDisabled().padding(.horizontal, 8).focused($focused).disabled(readOnly)
                .accessibilityIdentifier("labSourceEditor")
        }.navigationTitle(title + " 代码").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("收起键盘") { focused = false } }
            }
    }
}
struct CodeResultText: View {
    let text: String
    var body: some View {
        ScrollView(.horizontal) {
            Text(text).font(.system(.subheadline, design: .monospaced)).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
        }.frame(maxHeight: 450)
    }
}
struct NativeWaveformView: View {
    let waveform: LabWaveform
    @State private var zoom = 1.0
    @State private var time = 0.0
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(waveform.timescale).font(.caption).foregroundStyle(.secondary)
            if waveform.end.isFinite && waveform.end > 0 {
                Slider(value: $time, in: 0...waveform.end) { Text("时间游标") }
                LabeledContent("时间", value: String(format: "%.2f", time))
                Slider(value: $zoom, in: 1...4) { Text("波形缩放") }
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(waveform.signals.prefix(40))) { signal in
                            let current = signal.transitions.last(where: { $0.0 <= time })?.1 ?? "—"
                            Text(signal.name + " = " + current).font(.system(.caption, design: .monospaced)).lineLimit(2)
                            Canvas { context, size in
                                let values = signal.transitions
                                for (index, value) in values.enumerated() {
                                    let next = index + 1 < values.count ? values[index + 1].0 : waveform.end
                                    let x = max(0, min(size.width, value.0 / waveform.end * size.width))
                                    let right = max(x, min(size.width, next / waveform.end * size.width))
                                    let high = signal.width == 1 ? value.1 == "1" : true
                                    let y = high ? 5.0 : size.height - 5
                                    var path = Path()
                                    if signal.width > 1 {
                                        let inset = min(4, (right - x) / 2)
                                        path.move(to: .init(x: x, y: size.height / 2))
                                        path.addLines([.init(x: x + inset, y: 5), .init(x: right - inset, y: 5), .init(x: right, y: size.height / 2), .init(x: right - inset, y: size.height - 5), .init(x: x + inset, y: size.height - 5)])
                                        path.closeSubpath()
                                    } else {
                                        path.move(to: .init(x: x, y: y)); path.addLine(to: .init(x: right, y: y))
                                        if index > 0 { path.move(to: .init(x: x, y: 5)); path.addLine(to: .init(x: x, y: size.height - 5)) }
                                    }
                                    context.stroke(path, with: .color(value.1.lowercased().contains("x") || value.1.lowercased().contains("z") ? .orange : .teal), lineWidth: 2)
                                    if signal.width > 1, right - x > 40 { context.draw(Text(value.1).font(.system(size: 11, design: .monospaced)), at: .init(x: (x + right) / 2, y: 20)) }
                                }
                                var cursor = Path(); let x = time / waveform.end * size.width
                                cursor.move(to: .init(x: x, y: 0)); cursor.addLine(to: .init(x: x, y: size.height))
                                context.stroke(cursor, with: .color(.secondary), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                            }.frame(width: 300 * zoom, height: 40).accessibilityElement(children: .ignore)
                                .accessibilityLabel(signal.name + "，当前值 " + current + "，\(signal.transitions.count) 个变化点")
                        }
                    }
                }
            } else { Text("没有有效的时序数据。").foregroundStyle(.secondary) }
        }
    }
}
