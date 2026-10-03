import SwiftUI
import WebKit

struct WorkshopTool: Decodable, Identifiable {
    let id: String; let title: String; let description: String; let html: String
    let prompt: String?; let canEdit: Bool; let isPublished: Bool
}
struct WorkshopList: Decodable { let tools: [WorkshopTool] }
struct WorkshopResponse: Decodable { let tool: WorkshopTool }
struct GeneratedTool: Decodable { let html: String }

struct NativeToolsView: View {
    @Environment(AppStore.self) private var store
    let destination: LabDestination
    @State private var tools: [WorkshopTool] = []
    @State private var mine = false
    @State private var loading = false
    @State private var error: String?
    @State private var creating = false
    @State private var selected: WorkshopTool?
    var body: some View {
        List {
            if loading { ProgressView("正在加载工具…") }
            if let error { Text(error).foregroundStyle(.red); Button("重试") { Task { await load() } } }
            if tools.isEmpty && !loading && error == nil {
                ContentUnavailableView("还没有工具", systemImage: "hammer", description: Text("用 HTML 或 Max 制作一个自己的小工具。"))
            }
            ForEach(tools) { tool in
                NavigationLink { NativeToolDetailView(tool: tool) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(tool.title).font(.headline)
                        if !tool.description.isEmpty { Text(tool.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
                    }.padding(.vertical, 6)
                }
            }
        }.navigationTitle("工具工坊").listStyle(.insetGrouped)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu { Picker("范围", selection: $mine) { Text("工具广场").tag(false); Text("我的工具").tag(true) } } label: { Image(systemName: mine ? "person.crop.circle" : "square.grid.2x2") }.accessibilityLabel("筛选工具")
                }
                ToolbarItem(placement: .topBarTrailing) { Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel("制作工具").accessibilityIdentifier("createTool") }
            }
            .sheet(isPresented: $creating) { NavigationStack { NativeToolEditorView() }.environment(store) }
            .sheet(item: $selected) { tool in NavigationStack { NativeToolDetailView(tool: tool).toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { selected = nil } } } }.environment(store) }
            .task(id: mine) { await load() }
            .task {
                if !store.isDemo, let id = URLComponents(string: destination.path)?.queryItems?.first(where: { $0.name == "tool" })?.value,
                   id.range(of: "^t_[a-f0-9]{16}$", options: .regularExpression) != nil {
                    do { let response: WorkshopResponse = try await store.api.request("/api/tools/" + id); selected = response.tool }
                    catch { self.error = error.localizedDescription }
                }
            }
            .refreshable { await load() }
    }
    private func load() async {
        if store.isDemo { tools = [WorkshopTool(id: "preview", title: "学习计时器", description: "把专注时间分成小段，逐步完成今天的学习。", html: NativeToolEditorView.exampleHTML, prompt: nil, canEdit: false, isPublished: false)]; return }
        if mine && store.api.token == nil { store.showLogin = true; mine = false; return }
        loading = true; error = nil
        defer { loading = false }
        do { let response: WorkshopList = try await store.api.request("/api/tools", query: [.init(name: "scope", value: mine ? "mine" : "all"), .init(name: "limit", value: "50")]); tools = response.tools }
        catch { self.error = error.localizedDescription }
    }
}
struct NativeToolDetailView: View {
    @Environment(AppStore.self) private var store
    let tool: WorkshopTool
    @State private var editing = false
    @State private var draft: DiscussionDraft?
    var body: some View {
        ToolSandboxView(html: tool.html).navigationTitle(tool.title).navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("查看与复制代码", systemImage: "curlybraces") { editing = true }
                        if tool.isPublished {
                            Button("分享至讨论", systemImage: "bubble.left") {
                                guard !store.isDemo else { return }
                                if store.api.token == nil { store.showLogin = true; return }
                                var link = URLComponents(url: store.configuration.origin, resolvingAgainstBaseURL: false)!
                                link.path = "/tool-workshop"; link.queryItems = [.init(name: "tool", value: tool.id)]
                                if let url = link.url { draft = DiscussionDraft(title: String(tool.title.prefix(120)), content: "[使用小工具](\(url.absoluteString))\n\n", board: "daily") }
                            }
                        }
                    } label: { Image(systemName: "ellipsis") }.accessibilityLabel("工具操作")
                }
            }
            .sheet(isPresented: $editing) { NavigationStack { NativeToolEditorView(original: tool) }.environment(store) }
            .sheet(item: $draft) { item in NavigationStack { ComposeView(title: item.title, content: item.content, board: item.board) }.environment(store) }
    }
}
struct NativeToolEditorView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var description: String
    @State private var prompt = ""
    @State private var html: String
    @State private var editor = false
    @State private var preview = false
    @State private var confirmPublish = false
    @State private var busy = false
    @State private var error: String?
    @State private var generationTask: Task<Void, Never>?
    init(original: WorkshopTool? = nil) {
        _title = State(initialValue: original?.title ?? "我的小工具")
        _description = State(initialValue: original?.description ?? "")
        _html = State(initialValue: original?.html ?? Self.exampleHTML)
    }
    static let exampleHTML = """
    <!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:17px -apple-system,sans-serif;margin:24px;color:#153b38}button{font:inherit;padding:12px 24px;border:0;border-radius:16px;background:#18766d;color:white}h1{font-size:26px}</style></head><body><h1>学习计时器</h1><p id="time">25:00</p><button onclick="start()">开始专注</button><script>let remaining=1500,timer;function start(){if(timer)return;timer=setInterval(()=>{if(remaining>0)remaining--;document.getElementById('time').textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');if(!remaining){clearInterval(timer);timer=null}},1000)}</script></body></html>
    """
    var body: some View {
        @Bindable var store = store
        Form {
            Section("工具信息") {
                TextField("标题", text: $title)
                TextField("简介（选填）", text: $description, axis: .vertical).lineLimit(2...5)
            }.disabled(busy)
            Section("HTML") {
                Button { editor = true } label: { Label("编辑代码", systemImage: "curlybraces") }.disabled(busy)
                Button { preview = true } label: { Label("预览工具", systemImage: "play.rectangle") }.accessibilityIdentifier("previewTool")
                Text("\(html.count) 字符").font(.caption).foregroundStyle(.secondary)
            }
            Section {
                TextField("描述你想制作或修改的工具", text: $prompt, axis: .vertical).lineLimit(4...10).disabled(busy)
                if !store.aiConsent {
                    if store.user == nil { Button("登录并继续使用 Max") { store.showLogin = true } }
                    else { Toggle("同意使用 Max 并记住我的选择", isOn: $store.aiConsent).disabled(busy) }
                }
                if busy { ProgressView("Max 正在编写工具…"); Button("停止生成", role: .destructive) { generationTask?.cancel() } }
                else { Button("让 Max 制作", systemImage: "sparkles") { generate() }.disabled(!store.aiConsent || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || prompt.count > 2000 || html.count > 180000) }
            } header: { Text("Max 助手") } footer: { Text("需求和代码会发送到 FREE-BBS 的 AI 服务。请避免填写密码、密钥和个人敏感信息；生成后先预览，再决定是否公开发布。") }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }.navigationTitle("制作工具").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("发布") { if requireAccount() { confirmPublish = true } }.disabled(busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 120 || description.count > 500 || html.count > 180000 || html.isEmpty) }
            }
            .sheet(isPresented: $editor) { NavigationStack { SourceEditor(title: "HTML", source: $html) } }
            .sheet(isPresented: $preview) { NavigationStack { ToolSandboxView(html: html).navigationTitle("工具预览").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { preview = false } } } } }
            .confirmationDialog("发布到工具广场？", isPresented: $confirmPublish, titleVisibility: .visible) {
                Button("公开发布新工具") { Task { await publish() } }
            } message: { Text("标题、简介与 HTML 将公开。每次发布都会创建一个新工具，原有工具会保留。") }
            .onChange(of: store.aiConsent) { _, allowed in if !allowed { generationTask?.cancel() } }
            .onDisappear { generationTask?.cancel() }
    }
    private func requireAccount() -> Bool {
        guard !store.isDemo else { error = "示例模式不会生成或发布线上工具。"; return false }
        guard store.api.token != nil else { store.showLogin = true; return false }
        return true
    }
    private func generate() {
        guard requireAccount(), store.aiConsent else { return }
        generationTask = Task {
            busy = true; error = nil; defer { busy = false }
            do { let response: GeneratedTool = try await store.api.request("/api/tools/generate/html", method: "POST", body: ["prompt": prompt, "currentHtml": html], timeout: 330)
                try Task.checkCancellation(); html = response.html
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
    private func publish() async {
        busy = true; error = nil; defer { busy = false }
        do { let _: WorkshopResponse = try await store.api.request("/api/tools", method: "POST", body: ["title":title, "description":description, "prompt":prompt, "html":html]); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}

// The trusted wrapper has no account session or native message handlers. Authored
// HTML executes in an opaque frame, with the shared engine's network-blocking CSP.
struct ToolSandboxView: UIViewRepresentable {
    let html: String
    @Environment(\.colorScheme) private var scheme
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = context.coordinator
        web.loadHTMLString(RichContentEngine.document, baseURL: nil)
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.html = html; context.coordinator.dark = scheme == .dark
        context.coordinator.render(web)
    }
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) { web.stopLoading(); web.navigationDelegate = nil }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
        var html = ""; var dark = false; var ready = false; var key = ""
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { ready = true; render(webView) }
        func render(_ web: WKWebView) {
            guard ready else { return }
            web.evaluateJavaScript("document.documentElement.style.colorScheme = \(WebContentPolicy.json(dark ? "dark" : "light"))", completionHandler: nil)
            guard key != html else { return }
            key = html
            web.callAsyncJavaScript("""
            document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
            document.body.style.cssText = 'margin:0;padding:0;overflow:hidden';
            document.body.replaceChildren();
            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox','allow-scripts'); frame.title = '工具预览';
            frame.style.cssText = 'border:0;width:100%;height:100dvh;display:block';
            frame.srcdoc = FreeBbsToolEmbeds.sandboxDocument(html,true);
            document.body.append(frame);
            """, arguments: ["html":html, "dark":dark], in: nil, in: .page) { _ in }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            let url = action.request.url?.absoluteString ?? ""
            decisionHandler(url == "about:blank" || (url == "about:srcdoc" && action.targetFrame?.isMainFrame == false) ? .allow : .cancel)
        }
    }
}
