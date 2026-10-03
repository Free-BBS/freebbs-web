import SwiftUI
import WebKit

enum RichContentEngine {
    static let documentURL = Bundle.main.url(forResource: "RichContent", withExtension: "html")
    static let document: String = {
        guard let url = documentURL,
              let source = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return source
    }()
}

enum RichContentLoadState { case loading, ready, failed }

enum RichReferencePolicy {
    static func path(_ url: URL, origin: URL) -> String? {
        guard url.scheme == "https", url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, WebContentPolicy.sameOrigin(url, origin: origin),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.percentEncodedPath == url.path,
              url.path.range(of: "^/api/(tools/|labs/experiments/)[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil else { return nil }
        return url.path
    }
}

struct RichMarkdownContent: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var fontSize = 17.0
    let source: String
    @State private var height = 48.0
    @State private var destination: LabDestination?
    @State private var linkedPost: String?
    @State private var copied = false
    @State private var loadState = RichContentLoadState.loading
    @State private var retryVersion = 0
    var body: some View {
        Group {
            if loadState == .failed {
                VStack(alignment: .leading, spacing: 10) {
                    Label("正文暂时无法显示", systemImage: "doc.text.magnifyingglass")
                        .foregroundStyle(.secondary)
                    Button("重新加载") { height = 48; loadState = .loading; retryVersion += 1 }
                        .buttonStyle(.bordered)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
            } else {
                RichWebView(source: source, origin: store.configuration.origin, token: store.isDemo ? nil : store.api.token,
                            dark: colorScheme == .dark, fontSize: fontSize, allowReferences: !store.isDemo, height: $height,
                            readingStyle: ReadingStyle(raw: store.webPreferenceValues["free_bbs_typography_preferences"]),
                            loadState: $loadState,
                            link: open, copy: { value in UIPasteboard.general.string = value; copied = true })
                    .id("\(store.sessionRevision)-\(retryVersion)").frame(height: height)
                    .accessibilityIdentifier("richContent")
                    .overlay { if loadState == .loading { ProgressView("正在加载正文…").font(.caption) } }
                    .overlay(alignment: .topTrailing) {
                        if copied { Text("已复制").font(.caption).padding(8).background(.regularMaterial, in: Capsule())
                                .task { try? await Task.sleep(for: .seconds(2)); copied = false } }
                    }
            }
        }
            .sheet(item: $destination) { target in NavigationStack { LabWorkspaceView(destination: target)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { destination = nil } } } }.environment(store) }
            .sheet(isPresented: Binding(get: { linkedPost != nil }, set: { if !$0 { linkedPost = nil } })) {
                if let id = linkedPost { NavigationStack { PostDetailView(postID: id)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { linkedPost = nil } } } }.environment(store) }
            }
    }
    private func open(_ raw: String) {
        guard let url = AppConfiguration.safeLink(raw, origin: store.configuration.origin) else { return }
        if WebContentPolicy.labURL(url, origin: store.configuration.origin) {
            destination = .init(title: "实验与工具", path: url.absoluteString)
        } else if let id = AppConfiguration.postID(from: raw, origin: store.configuration.origin) { linkedPost = id }
        else if let feature = FeatureDestination(url: url, origin: store.configuration.origin) { store.featureDestination = feature }
        else { UIApplication.shared.open(url) }
    }
}

struct RichWebView: UIViewRepresentable {
    let source: String
    let origin: URL
    let token: String?
    let dark: Bool
    let fontSize: Double
    let allowReferences: Bool
    @Binding var height: Double
    let readingStyle: ReadingStyle
    @Binding var loadState: RichContentLoadState
    var referenceSession: URLSession? = nil
    let link: (String) -> Void
    let copy: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        makeWebView(coordinator: context.coordinator)
    }
    func makeWebView(coordinator: Coordinator) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(coordinator, name: "reader")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false; web.backgroundColor = .clear; web.scrollView.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false
        web.navigationDelegate = coordinator
        coordinator.loadDocument(web)
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.render(web)
    }
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        coordinator.invalidate()
        web.stopLoading(); web.navigationDelegate = nil
        web.configuration.userContentController.removeScriptMessageHandler(forName: "reader")
    }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: RichWebView
        var ready = false
        var renderedKey = ""
        private var recoveryCount = 0
        private var recoveryTask: Task<Void, Never>?
        private var loadingDeadline: Task<Void, Never>?
        private var invalidated = false
        private var documentRendered = false
        private var loadGeneration = 0
        private weak var webView: WKWebView?
        private var referenceTasks: [String: Task<Void, Never>] = [:]
        init(_ parent: RichWebView) { self.parent = parent }
        func invalidate() {
            invalidated = true
            recoveryTask?.cancel(); recoveryTask = nil
            loadingDeadline?.cancel(); loadingDeadline = nil
            referenceTasks.values.forEach { $0.cancel() }; referenceTasks.removeAll()
        }
        func loadDocument(_ web: WKWebView) {
            guard !invalidated else { return }
            webView = web
            referenceTasks.values.forEach { $0.cancel() }; referenceTasks.removeAll()
            ready = false; renderedKey = ""
            documentRendered = false; loadGeneration += 1
            Task { @MainActor [weak self] in
                guard let self, !self.invalidated, !self.documentRendered else { return }
                self.parent.loadState = .loading
            }
            guard let url = RichContentEngine.documentURL else {
                Task { @MainActor [weak self] in self?.parent.loadState = .failed }
                return
            }
            // Load the trusted bundle document directly. This avoids synthetic
            // HTML navigation origins and gives WebKit a stable document URL.
            // All network links are still resolved against the explicit site origin.
            web.loadFileURL(url, allowingReadAccessTo: url)
            loadingDeadline?.cancel()
            loadingDeadline = Task { @MainActor [weak self, weak web] in
                do { try await Task.sleep(for: .seconds(20)) } catch { return }
                guard let self, let web, !self.invalidated, !self.documentRendered else { return }
                self.recover(web)
            }
        }
        private func recover(_ web: WKWebView) {
            guard !invalidated else { return }
            ready = false; renderedKey = ""
            loadingDeadline?.cancel(); loadingDeadline = nil
            guard recoveryCount < 2 else { parent.loadState = .failed; return }
            recoveryCount += 1; parent.loadState = .loading
            recoveryTask?.cancel()
            recoveryTask = Task { @MainActor [weak self, weak web] in
                do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
                guard let self, let web, !self.invalidated else { return }
                self.loadDocument(web)
            }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { ready = true; render(webView) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { recover(webView) }
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { recover(webView) }
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { recover(webView) }
        func render(_ web: WKWebView) {
            let key = parent.source + "|\(parent.dark)|\(parent.fontSize)|\(parent.allowReferences)|\(parent.readingStyle)"
            guard ready, key != renderedKey else { return }
            renderedKey = key
            let generation = loadGeneration
            web.callAsyncJavaScript("""
                window.nativeReaderGeneration = generation;
                window.renderNativeContent(source, origin, token, dark, fontSize, allowReferences);
                document.body.style.fontFamily = bodyFamily;
                for (const heading of document.querySelectorAll('#content h1,#content h2,#content h3')) heading.style.fontFamily = headingFamily;
                """,
                arguments: ["source":parent.source, "origin":parent.origin.absoluteString, "token":parent.token ?? "", "dark":parent.dark,
                            "fontSize":parent.fontSize * parent.readingStyle.scale, "allowReferences":parent.allowReferences,
                            "generation":generation,
                            "bodyFamily":parent.readingStyle.bodyFamily, "headingFamily":parent.readingStyle.headingFamily], in: nil, in: .page) { [weak self] result in
                guard let self, !self.invalidated, self.loadGeneration == generation, self.renderedKey == key else { return }
                switch result {
                case .success:
                    self.documentRendered = true
                    self.loadingDeadline?.cancel(); self.loadingDeadline = nil
                    self.parent.loadState = .ready
                case .failure: self.recover(web)
                }
            }
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            // Opaque tool frames have no access to native clipboard, navigation or sizing.
            guard !invalidated, message.frameInfo.isMainFrame, let data = message.body as? [String: Any] else { return }
            if data["type"] as? String == "fetch" || data["type"] as? String == "cancelFetch" {
                guard data["generation"] as? Int == loadGeneration,
                      let id = data["id"] as? String, id.count <= 80 else { return }
                if data["type"] as? String == "cancelFetch" { referenceTasks.removeValue(forKey: id)?.cancel(); return }
                fetchReference(data, id: id); return
            }
            if data["type"] as? String == "height", let value = data["value"] as? Double, value.isFinite {
                let next = max(24, min(200000, value))
                if abs(parent.height - next) > 1 { parent.height = next }
            } else if data["type"] as? String == "link", let value = data["value"] as? String { parent.link(value) }
            else if data["type"] as? String == "copy", let value = data["value"] as? String, value.count <= 50000 { parent.copy(value) }
        }
        private func fetchReference(_ data: [String: Any], id: String) {
            guard let web = webView else { return }
            let generation = loadGeneration
            guard referenceTasks[id] == nil, referenceTasks.count < 8,
                  data["method"] as? String == "GET", let raw = data["url"] as? String,
                  let url = URL(string: raw), let path = RichReferencePolicy.path(url, origin: parent.origin) else {
                finishReference(web, id: id, generation: generation, status: 403, body: "{}"); return
            }
            let api = APIClient(origin: parent.origin, session: parent.referenceSession)
            api.token = parent.token
            referenceTasks[id] = Task { @MainActor [weak self, weak web] in
                var status = 200; var body = "{}"
                do {
                    let record: SiteRecord = try await api.request(path, timeout: 15)
                    let encoded = try JSONEncoder().encode(record)
                    guard encoded.count <= 5 * 1024 * 1024, let value = String(data: encoded, encoding: .utf8) else { throw APIError.invalidResponse }
                    body = value
                } catch APIError.unauthorized { status = 401 }
                catch APIError.server(let code, _) { status = (400...599).contains(code) ? code : 502 }
                catch { status = 503 }
                guard let self, !self.invalidated, self.loadGeneration == generation else { return }
                self.referenceTasks[id] = nil
                guard let web, !Task.isCancelled else { return }
                self.finishReference(web, id: id, generation: generation, status: status, body: body)
            }
        }
        private func finishReference(_ web: WKWebView, id: String, generation: Int, status: Int, body: String) {
            web.callAsyncJavaScript("window.finishNativeReference(id, generation, status, body)",
                arguments: ["id":id, "generation":generation, "status":status, "body":body], in: nil, in: .page) { _ in }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            if action.navigationType == .other, let url = action.request.url,
               url.isFileURL, url.standardizedFileURL == RichContentEngine.documentURL?.standardizedFileURL {
                decisionHandler(.allow); return
            }
            if action.navigationType == .other, let url = action.request.url,
               url.absoluteString == "about:blank" || WebContentPolicy.sameOrigin(url, origin: parent.origin) {
                decisionHandler(.allow); return
            }
            decisionHandler(.cancel)
            if let url = action.request.url { parent.link(url.absoluteString) }
        }
    }
}
