import SwiftUI
import WebKit

struct LabDestination: Identifiable, Hashable {
    let title: String
    let path: String
    var id: String { path }
    static let entries: [(String, String, String, String)] = [
        ("电路实验室", "搭建电路、运行仿真、观察波形", "cpu", "/circuits"),
        ("电路挑战", "用实际电路解题，检验分析与设计", "bolt.badge.clock", "/circuit-challenge"),
        ("C / C++", "运行代码，比较多架构汇编", "curlybraces", "/code-lab?language=cpp"),
        ("Python", "逐步执行，观察变量与输出", "terminal", "/code-lab?language=python"),
        ("Octave", "MATLAB 兼容计算、矩阵与绘图", "waveform.path", "/code-lab?language=matlab"),
        ("Verilog", "数字电路仿真与时序波形", "waveform", "/code-lab?language=verilog"),
        ("制作我的工具", "编写、预览和分享 HTML 工具", "hammer", "/tool-workshop")
    ]
}

enum WebContentPolicy {
    static let labPaths: Set<String> = ["/laboratory", "/circuits", "/circuit", "/circuit-challenge", "/code-lab", "/tool-workshop", "/circuit-embed"]
    static func sameOrigin(_ url: URL, origin: URL) -> Bool {
        url.scheme == "https" && url.host == origin.host && url.port == origin.port && url.user == nil && url.password == nil
    }
    static func labURL(_ url: URL, origin: URL) -> Bool {
        sameOrigin(url, origin: origin) && labPaths.contains(url.path)
    }
    static func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }
    static func sessionScript(origin: URL, token: String?, dark: Bool) -> String {
        // Only trusted, first-party lab documents receive the ephemeral web session.
        """
        (() => {
          const expected = \(json(origin.absoluteString));
          const paths = \(json(Array(labPaths).sorted()));
          if (location.origin !== new URL(expected).origin || !paths.includes(location.pathname)) return;
          const token = \(json(token ?? ""));
          if (token) localStorage.setItem('free_bbs_auth_token', token);
          else localStorage.removeItem('free_bbs_auth_token');
          localStorage.setItem('free_bbs_theme_mode', \(json(dark ? "dark" : "light")));
        })();
        """
    }
}

struct LaboratoryView: View {
    var body: some View {
        PageSurface {
            VStack(alignment: .leading, spacing: 10) {
                Text("把想法，变成实验。").font(.largeTitle.bold())
                Text("搭建、运行、观察，再把结果带回讨论。").foregroundStyle(.secondary)
            }.padding(.vertical, 8)
            ForEach(Array(LabDestination.entries.enumerated()), id: \.offset) { _, entry in
                NavigationLink {
                    LabWorkspaceView(destination: .init(title: entry.0, path: entry.3))
                } label: {
                    HStack(spacing: 16) {
                        Image(systemName: entry.2).font(.title2).foregroundStyle(Palette.teal)
                            .frame(width: 50, height: 50).background(Palette.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(entry.0).font(.headline).foregroundStyle(.primary)
                            Text(entry.1).font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
                    }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.paper, in: RoundedRectangle(cornerRadius: 22))
                }.buttonStyle(.plain).accessibilityIdentifier("lab-" + entry.3)
            }
        }.navigationTitle("实验室")
    }
}

struct LabDialog: Identifiable {
    enum Kind { case notice, confirmation, text }
    let id = UUID()
    let kind: Kind
    let message: String
    let completion: (String?) -> Void
}
struct LabExport: Identifiable { let id = UUID(); let url: URL }

@MainActor @Observable final class LabBrowserState {
    var webView: WKWebView?
    var loading = true
    var error: String?
    var progress = 0.0
    var canGoBack = false
    var dialog: LabDialog?
    var presentingDialog = false
    var promptText = ""
    var export: LabExport?
    var downloadError: String?
    func resolveDialog(_ result: String?) {
        let completion = dialog?.completion
        dialog = nil; presentingDialog = false
        completion?(result)
    }
}

struct LabWorkspaceView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    let destination: LabDestination
    @State private var browser = LabBrowserState()
    var body: some View {
        VStack(spacing: 0) {
            if browser.loading && !store.isDemo { ProgressView(value: browser.progress).tint(Palette.teal) }
            if store.isDemo {
                ContentUnavailableView("实验室预览", systemImage: "flask", description: Text("正式版本连接完整实验工作区。示例模式不会运行或保存线上实验。"))
            } else if let error = browser.error {
                ContentUnavailableView {
                    Label("实验室暂时无法加载", systemImage: "wifi.exclamationmark")
                } description: { Text(error) } actions: {
                    Button("重试") { browser.error = nil; browser.webView?.reload() }.buttonStyle(.borderedProminent)
                }
            }
            if !store.isDemo {
                LabWebView(destination: destination, origin: store.configuration.origin, token: store.api.token,
                           dark: colorScheme == .dark, browser: browser, login: { store.showLogin = true })
                    .id(store.sessionRevision).opacity(browser.error == nil ? 1 : 0)
                    .frame(maxWidth: .infinity, maxHeight: browser.error == nil ? .infinity : 0)
            }
        }.background(Palette.canvas)
            .navigationTitle(destination.title).navigationBarTitleDisplayMode(.inline)
            .alert("实验室", isPresented: $browser.presentingDialog, presenting: browser.dialog) { dialog in
                if dialog.kind == .text { TextField("输入内容", text: $browser.promptText) }
                if dialog.kind != .notice { Button("取消", role: .cancel) { browser.resolveDialog(nil) } }
                Button("确定") { browser.resolveDialog(dialog.kind == .text ? browser.promptText : "confirmed") }
            } message: { dialog in Text(dialog.message) }
            .alert("无法导出", isPresented: Binding(get: { browser.downloadError != nil }, set: { if !$0 { browser.downloadError = nil } })) {
                Button("确定", role: .cancel) { browser.downloadError = nil }
            } message: { Text(browser.downloadError ?? "") }
            .sheet(item: $browser.export, onDismiss: { browser.export = nil }) { item in
                LabShareSheet(url: item.url)
            }
            .onDisappear { browser.resolveDialog(nil) }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { browser.webView?.goBack() } label: { Image(systemName: "chevron.backward") }
                        .disabled(!browser.canGoBack).accessibilityLabel("返回上一实验页面")
                    Button { browser.error = nil; browser.webView?.reload() } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("刷新实验室")
                }
            }
    }
}

private struct LabWebView: UIViewRepresentable {
    let destination: LabDestination
    let origin: URL
    let token: String?
    let dark: Bool
    let browser: LabBrowserState
    let login: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.addUserScript(.init(source: WebContentPolicy.sessionScript(origin: origin, token: token, dark: dark), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addUserScript(.init(source: Self.mobileScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator; web.uiDelegate = context.coordinator
        web.isOpaque = false; web.backgroundColor = .clear
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.keyboardDismissMode = .interactive
        context.coordinator.progress = web.observe(\.estimatedProgress, options: [.new]) { [weak browser] web, _ in
            Task { @MainActor [weak web] in
                if let web { browser?.progress = web.estimatedProgress }
            }
        }
        browser.webView = web
        if let url = URL(string: destination.path, relativeTo: origin)?.absoluteURL,
           WebContentPolicy.labURL(url, origin: origin) { web.load(URLRequest(url: url)) }
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        web.evaluateJavaScript("if (typeof applyThemeMode === 'function') applyThemeMode(\(WebContentPolicy.json(dark ? "dark" : "light")))", completionHandler: nil)
    }
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.stopLoading(); web.navigationDelegate = nil; web.uiDelegate = nil
        coordinator.progress?.invalidate()
        coordinator.parent.browser.webView = nil
    }
    private static let mobileScript = """
    (() => {
      const style = document.createElement('style');
      style.textContent = `
        .topbar,.sidebar,.mobile-nav,.mobile-tools,.desktop-shell-rail,.max-guide-launcher { display:none!important; }
        :root { --mobile-nav-space:0px; --font-ui:-apple-system,BlinkMacSystemFont,sans-serif; }
        body,.page-shell,.dashboard-shell { padding:0!important; margin:0!important; min-height:100dvh!important; }
        .main-content { margin-left:0!important; width:100%!important; padding:16px!important; box-sizing:border-box; }
        input,textarea,select { font-size:16px!important; }
        button,a.lab-back,.tool-studio button { min-height:44px; touch-action:manipulation; }
        .lab-back { display:none; }
        .lab-heading { align-items:flex-start; gap:12px; }
        .lab-languages,.lab-result-tabs { flex-wrap:nowrap; overflow-x:auto; padding-bottom:10px; }
        .lab-languages button,.lab-result-tabs button { flex-shrink:0; }
        .lab-workspace,.tool-studio { grid-template-columns:minmax(0,1fr)!important; }
        pre,.lab-wave-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        .circuit-mobile-heading { top:0!important; }
        .has-circuit-mobile-workspace .main-content { padding:0!important; }
        .circuit-mobile-dock { padding-bottom:8px!important; }
      `;
      document.head.append(style);
    })();
    """
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        var parent: LabWebView
        var progress: NSKeyValueObservation?
        var downloads: [ObjectIdentifier: URL] = [:]
        init(_ parent: LabWebView) { self.parent = parent }
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.browser.loading = true; parent.browser.error = nil
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.browser.loading = false; parent.browser.canGoBack = webView.canGoBack
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
        private func failed(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            parent.browser.loading = false; parent.browser.error = error.localizedDescription
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if action.shouldPerformDownload, action.sourceFrame.isMainFrame,
               (WebContentPolicy.sameOrigin(url, origin: parent.origin) || url.scheme == "blob") {
                decisionHandler(.download); return
            }
            if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            if WebContentPolicy.labURL(url, origin: parent.origin) { decisionHandler(.allow); return }
            decisionHandler(.cancel)
            if WebContentPolicy.sameOrigin(url, origin: parent.origin), ["/login", "/register"].contains(url.path) { parent.login() }
            else if action.navigationType == .linkActivated, AppConfiguration.safeLink(url.absoluteString, origin: parent.origin) != nil { UIApplication.shared.open(url) }
        }
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
            guard let url = response.response.url else { decisionHandler(.cancel); return }
            if !response.isForMainFrame { decisionHandler(.allow); return }
            guard WebContentPolicy.sameOrigin(url, origin: parent.origin) || url.scheme == "blob" else { decisionHandler(.cancel); return }
            let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") == true
            decisionHandler(attachment || !response.canShowMIMEType ? .download : .allow)
        }
        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
            do {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("LabExport-" + UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let filename = URL(fileURLWithPath: suggestedFilename).lastPathComponent
                let url = directory.appendingPathComponent(filename.isEmpty ? "实验导出" : filename)
                downloads[ObjectIdentifier(download)] = url
                completionHandler(url)
            } catch { parent.browser.downloadError = error.localizedDescription; completionHandler(nil) }
        }
        func downloadDidFinish(_ download: WKDownload) {
            if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) { parent.browser.export = LabExport(url: url) }
        }
        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
            parent.browser.downloadError = error.localizedDescription
        }
        func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping @MainActor (WKDownload.RedirectPolicy) -> Void) {
            decisionHandler(request.url.map { WebContentPolicy.sameOrigin($0, origin: parent.origin) } == true ? .allow : .cancel)
        }
        private func present(_ kind: LabDialog.Kind, message: String, initial: String = "", completion: @escaping (String?) -> Void) {
            parent.browser.resolveDialog(nil)
            parent.browser.promptText = initial
            parent.browser.dialog = LabDialog(kind: kind, message: message, completion: completion)
            parent.browser.presentingDialog = true
        }
        private func trusted(_ frame: WKFrameInfo) -> Bool {
            frame.isMainFrame && frame.request.url.map { WebContentPolicy.labURL($0, origin: parent.origin) } == true
        }
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
            guard trusted(frame) else { completionHandler(); return }
            present(.notice, message: message) { _ in completionHandler() }
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
            guard trusted(frame) else { completionHandler(false); return }
            present(.confirmation, message: message) { completionHandler($0 != nil) }
        }
        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
            guard trusted(frame) else { completionHandler(nil); return }
            present(.text, message: prompt, initial: defaultText ?? "", completion: completionHandler)
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let url = action.request.url else { return nil }
            if WebContentPolicy.labURL(url, origin: parent.origin) { webView.load(action.request) }
            else if AppConfiguration.safeLink(url.absoluteString, origin: parent.origin) != nil { UIApplication.shared.open(url) }
            return nil
        }
    }
}

private struct LabShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
