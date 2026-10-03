import SwiftUI

struct ChatMessage: Identifiable, Codable {
    let id: UUID
    let role: String
    let content: String
    init(role: String, content: String) { id = UUID(); self.role = role; self.content = content }
}
struct AIResponse: Decodable {
    let reply: String?
    let content: String?
    let answer: String?
    let message: String?
    let response: String?
    var text: String? { [reply, content, answer, message, response].compactMap { $0 }.first { !$0.isEmpty } }
}
struct ChatView: View {
    @Environment(AppStore.self) private var store
    var context: String = ""
    @State private var messages: [ChatMessage] = []
    @State private var question = ""
    @State private var busy = false
    @State private var sendingTask: Task<Void, Never>?
    var body: some View {
        @Bindable var store = store
        ScrollViewReader { proxy in
            PageSurface {
                if messages.isEmpty {
                    VStack(alignment: .leading, spacing: 16) {
                        Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(Palette.teal).accessibilityHidden(true)
                        Text("从一个问题开始。").font(.title.bold())
                        Text("Max 可以帮助梳理知识、解释推导。回答可能有误，请结合课程资料核实。")
                            .foregroundStyle(.secondary)
                        if !context.isEmpty { Label("已带入当前知识点", systemImage: "book").font(.caption).foregroundStyle(Palette.teal) }
                    }.padding(.vertical, 24)
                    if !store.aiConsent { Paper {
                        Text("首次使用 Max").font(.headline)
                        Text("使用 Max 时，你主动发送的问题、对话上下文，以及工具制作需求和代码会发送到 FREE-BBS 后端及其配置的 AI 服务提供商。请勿输入密码、学号等敏感信息。")
                            .font(.subheadline).foregroundStyle(.secondary)
                        if store.user == nil { Button("登录并继续") { store.showLogin = true }.buttonStyle(.bordered) }
                        else { Toggle("同意使用 Max 并记住我的选择", isOn: $store.aiConsent).accessibilityIdentifier("maxConsent") }
                        Text("你可随时在“我的 → Max 数据使用”撤回同意。").font(.caption).foregroundStyle(.secondary)
                        Text("具体服务提供商须由运营方在正式隐私政策中公开。").font(.caption).foregroundStyle(.secondary)
                    } }
                    ForEach(["用一个例子解释卷积", "怎样安排今天的复习？"], id: \.self) { suggestion in
                        Button { question = suggestion } label: { Label(suggestion, systemImage: "arrow.turn.down.right").frame(minHeight: 44) }
                            .buttonStyle(.plain)
                    }
                }
                ForEach(messages) { message in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message.role == "user" ? "你" : "Max").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        MarkdownContent(source: message.content)
                    }.padding(message.role == "user" ? 16 : 0)
                        .background(message.role == "user" ? Palette.paper : Color.clear, in: RoundedRectangle(cornerRadius: 20)).id(message.id)
                }
                if busy { HStack { ProgressView(); Text("Max 正在思考…").foregroundStyle(.secondary) }.id("thinking") }
            }
            .onChange(of: messages.count) { _, _ in if let id = messages.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
        }
        .navigationTitle("问问 Max").navigationBarTitleDisplayMode(.inline)
        .safeAreaBar(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 12) {
                TextField("想问点什么？", text: $question, axis: .vertical).lineLimit(1...5)
                    .padding(.horizontal, 16).padding(.vertical, 12).glassEffect(.regular, in: Capsule())
                Button {
                    if busy { sendingTask?.cancel() }
                    else { sendingTask = Task { await send() } }
                } label: {
                    Image(systemName: busy ? "stop.fill" : "arrow.up").font(.headline).frame(width: 48, height: 48).glassAction()
                }.accessibilityLabel(busy ? "停止回答" : "发送问题").disabled(!busy && (question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !store.aiConsent))
            }.padding(.horizontal, 16).padding(.vertical, 8)
        }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("清空") { sendingTask?.cancel(); messages = [] }.disabled(busy) } }
        .onDisappear { sendingTask?.cancel() }
        .onChange(of: store.aiConsent) { _, allowed in if !allowed { sendingTask?.cancel() } }
        .onChange(of: store.sessionRevision) { _, _ in sendingTask?.cancel(); messages = [] }
    }
    private func send() async {
        guard store.requireLogin(), store.aiConsent else { return }
        guard !store.isDemo else { store.error = "预览模式不会向 AI 服务发送消息。"; return }
        guard question.count <= 4000 else { store.error = "问题不能超过 4000 个字符。"; return }
        let prompt = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let outgoing = ChatMessage(role: "user", content: prompt)
        question = ""; messages.append(outgoing); busy = true
        defer { busy = false }
        let session = store.sessionRevision
        do {
            var history: [[String: String]] = messages.suffix(12).map { ["role": $0.role, "content": $0.content] }
            if !context.isEmpty { history.insert(["role": "system", "content": context], at: 0) }
            let response: AIResponse = try await store.api.request("/api/ai/chat", method: "POST", body: ["messages": history, "stream": false])
            try Task.checkCancellation()
            guard session == store.sessionRevision else { return }
            guard let text = response.text else { throw APIError.invalidResponse }
            messages.append(.init(role: "assistant", content: text))
        } catch is CancellationError { }
        catch {
            if !Task.isCancelled && session == store.sessionRevision {
                store.error = error.localizedDescription; question = prompt
                messages.removeAll { $0.id == outgoing.id }
            }
        }
    }
}
