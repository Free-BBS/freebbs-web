import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct ChatMessage: Identifiable, Codable {
    let id: UUID
    let role: String
    let content: String
    var metadata: [String: SiteRecord] = [:]
    var payload: [String: Any] { var fields = metadata.mapValues(\.value); fields["role"] = role; fields["content"] = content; return fields }
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
    @State private var library = false
    @State private var dialogID = UUID().uuidString
    @State private var model = ""
    @State private var effort = "auto"
    @State private var attachments = MaxAttachments()
    @State private var photo: PhotosPickerItem?
    @State private var importing = false
    @State private var background = NativeMaxTask()
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
                        Text("你可随时在“工具 → 个人设置”撤回同意。").font(.caption).foregroundStyle(.secondary)
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
                        NativeMaxAttachmentsView(metadata: message.metadata)
                    }.padding(message.role == "user" ? 16 : 0)
                        .background(message.role == "user" ? Palette.paper : Color.clear, in: RoundedRectangle(cornerRadius: 20)).id(message.id)
                }
                if !busy && background.record != .null { Button("查看后台回答", systemImage: "arrow.clockwise") { sendingTask = Task { await restoreAnswer() } }.disabled(!store.aiConsent) }
                if busy { HStack { ProgressView(); Text(background.progress).foregroundStyle(.secondary) }.id("thinking") }
            }
            .onChange(of: messages.count) { _, _ in if let id = messages.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
        }
        .navigationTitle("问问 Max").navigationBarTitleDisplayMode(.inline)
        .safeAreaBar(edge: .bottom) {
            VStack(spacing: 6) {
                if attachments.busy { ProgressView(value: attachments.progress) }
                if let error = attachments.error { Text(error).font(.caption).foregroundStyle(.red) }
                if !attachments.images.isEmpty || !attachments.documents.isEmpty || !attachments.textFiles.isEmpty {
                    HStack {
                        Text("\(attachments.images.count) 张图片 · \(attachments.documents.count + attachments.textFiles.count) 个文件").font(.caption)
                        Spacer(); Button("移除附件") { attachments.reset() }.font(.caption)
                    }.padding(.horizontal, 16)
                }
                HStack(alignment: .bottom, spacing: 12) {
                Menu {
                    PhotosPicker("添加图片", selection: $photo, matching: .images)
                    Button("添加文档", systemImage: "doc") { importing = true }
                } label: { Image(systemName: "plus").frame(width: 44, height: 44) }.accessibilityLabel("添加附件").disabled(busy || attachments.busy || !store.aiConsent)
                TextField("想问点什么？", text: $question, axis: .vertical).lineLimit(1...5)
                    .padding(.horizontal, 16).padding(.vertical, 12).glassEffect(.regular, in: Capsule())
                Button {
                    if busy { sendingTask?.cancel(); Task { await background.cancel(store) } }
                    else { sendingTask = Task { await send() } }
                } label: {
                    Image(systemName: busy ? "stop.fill" : "arrow.up").font(.headline).frame(width: 48, height: 48).glassAction()
                }.accessibilityLabel(busy ? "停止回答" : "发送问题").disabled(!busy && ((question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.images.isEmpty && attachments.documents.isEmpty && attachments.textFiles.isEmpty) || attachments.busy || !store.aiConsent))
                }.padding(.horizontal, 16).padding(.vertical, 8)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("新对话", systemImage: "square.and.pencil") { sendingTask?.cancel(); messages = []; dialogID = UUID().uuidString; attachments.reset() }.disabled(busy) }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("对话记录", systemImage: "clock") { if store.requireLogin() { library = true } }
                    NavigationLink { NativeMaxModels(model: $model, effort: $effort) } label: { Label("模型与思考", systemImage: "slider.horizontal.3") }
                } label: { Image(systemName: "ellipsis") }.accessibilityLabel("Max 菜单")
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data], allowsMultipleSelection: false) { result in
            switch result {
            case let .success(urls): if let url = urls.first { attachments.task = Task { await attachments.addFile(url, store: store) } }
            case let .failure(error): attachments.error = error.localizedDescription
            }
        }
        .onChange(of: photo) { _, item in Task {
            let session = store.sessionRevision
            do { if let data = try await item?.loadTransferable(type: Data.self), session == store.sessionRevision { attachments.addImage(data) } }
            catch { attachments.error = error.localizedDescription }
        } }
        .sheet(isPresented: $library) { NavigationStack { NativeMaxLibrary { dialog in messages = dialog.messages; dialogID = dialog.id }.environment(store) } }
        .task(id: store.sessionRevision) {
            let raw = store.webPreferenceValues["free_bbs_max_model_v1:" + (store.user?.uid.isEmpty == false ? store.user!.uid : "local")]
            if let data = raw?.data(using: .utf8), let value = try? JSONDecoder().decode(SiteRecord.self, from: data) { model = value["model"].text; effort = value["reasoning_effort"].text.isEmpty ? "auto" : value["reasoning_effort"].text }
            await background.restore(store)
        }
        .onDisappear { sendingTask?.cancel(); background.leave(store) }
        .onChange(of: store.aiConsent) { _, allowed in if !allowed { sendingTask?.cancel(); attachments.reset(); Task { await background.cancel(store) } } }
        .onChange(of: store.sessionRevision) { _, _ in sendingTask?.cancel(); messages = []; dialogID = UUID().uuidString; library = false; model = ""; attachments.reset() }
    }
    private func restoreAnswer() async {
        guard store.requireLogin(), store.aiConsent, !store.isDemo else { return }
        busy = true; defer { busy = false }
        let owner = store.sessionRevision
        do {
            let did = background.record["scopeId"].text
            let saved: SiteRecord = try await store.api.request("/api/ai/dialogs/" + NativeRoutes.component(did))
            let restored = saved["dialog"]["messages"].list.map { record in var message = ChatMessage(role: record["role"].text, content: record["content"].text); message.metadata = record.fields.filter { !["role", "content"].contains($0.key) }; return message }
            let response = try await background.wait(store)
            try Task.checkCancellation(); guard owner == store.sessionRevision else { return }
            let text = response["answer"].text
            guard !text.isEmpty else { throw APIError.invalidResponse }
            dialogID = did; messages = restored
            var answer = ChatMessage(role: "assistant", content: text); answer.metadata = response.fields.filter { ["navigation", "rag", "generated_images", "artifact"].contains($0.key) }; if messages.last?.role != "assistant" || messages.last?.content != text { messages.append(answer) }
            let _: SiteRecord = try await store.api.request("/api/ai/dialogs", method: "POST", body: ["did": did, "messages": messages.map(\.payload)])
            await background.acknowledge(store)
        } catch { if owner == store.sessionRevision && !Task.isCancelled { store.error = error.localizedDescription } }
    }
    private func send() async {
        guard store.requireLogin(), store.aiConsent else { return }
        guard !store.isDemo else { store.error = "预览模式不会向 AI 服务发送消息。"; return }
        guard question.count <= 4000 else { store.error = "问题不能超过 4000 个字符。"; return }
        let original = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let prompt = (original.isEmpty ? "请分析这些附件。" : original) + attachments.context
        guard prompt.count <= 80000 else { store.error = "附件文字过长，请分次发送。"; return }
        var outgoing = ChatMessage(role: "user", content: prompt)
        if !attachments.images.isEmpty { outgoing.metadata["images"] = .array(attachments.images) }
        if !attachments.documents.isEmpty { outgoing.metadata["documents"] = .array(attachments.documents) }
        question = ""; messages.append(outgoing); busy = true
        defer { busy = false }
        let session = store.sessionRevision
        do {
            var history: [[String: Any]] = messages.suffix(12).map(\.payload)
            if !context.isEmpty { history.insert(["role": "system", "content": context], at: 0) }
            var body: [String: Any] = ["messages": history, "stream": false, "did": dialogID]
            if !attachments.images.isEmpty { body["vision_images"] = attachments.images.map(\.value) }
            let documents = attachments.documents.isEmpty ? messages.last(where: { $0.metadata["documents"] != nil })?.metadata["documents"]?.list ?? [] : attachments.documents
            if !documents.isEmpty { body["documents"] = documents.map(\.value) }
            if !model.isEmpty { body["model"] = model; body["reasoning_effort"] = effort }
            let _: SiteRecord = try await store.api.request("/api/ai/dialogs", method: "POST", body: ["did": dialogID, "messages": messages.map(\.payload)])
            let response = try await background.start(store, dialog: dialogID, payload: body)
            try Task.checkCancellation()
            guard session == store.sessionRevision else { return }
            let text = (["reply", "content", "answer", "response"].map { response[$0].text } + [response["choices"].list.first?["message"]["content"].text ?? ""]).first { !$0.isEmpty }
            guard let text else { throw APIError.invalidResponse }
            var answer = ChatMessage(role: "assistant", content: text); answer.metadata = response.fields.filter { ["navigation", "rag", "generated_images", "artifact"].contains($0.key) }; messages.append(answer); attachments.reset()
            do {
                let _: SiteRecord = try await store.api.request("/api/ai/dialogs", method: "POST", body: ["did": dialogID, "messages": messages.map(\.payload)])
                await background.acknowledge(store)
            } catch { if session == store.sessionRevision { store.error = "回答已收到，但对话保存失败：" + error.localizedDescription } }
        } catch is CancellationError { }
        catch {
            if !Task.isCancelled && session == store.sessionRevision {
                store.error = error.localizedDescription; question = original
                messages.removeAll { $0.id == outgoing.id }
            }
        }
    }
}
