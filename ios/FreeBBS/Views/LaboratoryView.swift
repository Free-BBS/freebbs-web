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
          if (['/circuit','/circuit-challenge'].includes(location.pathname)) {
            \(nativeViewportScript)
          }
          localStorage.setItem('free_bbs_theme_mode', \(json(dark ? "dark" : "light")));
        })();
        """
    }
    // The native host already owns safe areas and toolbars; the web canvas owns none.
    static let nativeCircuitCSS = """
    html.freebbs-native-lab, html.freebbs-native-lab body { height:100%; overflow:hidden!important; }
    html.freebbs-native-lab body > .page-shell { height:100dvh!important; min-height:0!important; }
    html.freebbs-native-lab body .page-shell > :is(.circuit-main,.challenge-main) {
      position:fixed!important; inset:0!important; height:100%!important; min-height:0!important;
      padding:0!important; margin:0!important; max-width:none!important; overflow:hidden;
    }
    html.freebbs-native-lab body .page-shell > :is(.circuit-main,.challenge-main)::before { display:none!important; }
    html.freebbs-native-lab body .page-shell :is(.circuit-workspace,.circuit-editor-layout,.circuit-editor-content,.challenge-layout,.challenge-workbench,.challenge-build-area) { display:contents!important; }
    html.freebbs-native-lab body .page-shell :is(.circuit-canvas-panel,.challenge-canvas-wrap) {
      position:absolute!important; inset:0!important; display:flex!important; flex-direction:column;
      min-height:0!important; height:auto!important; border:0!important; border-radius:0!important;
    }
    html.freebbs-native-lab body .page-shell :is(.circuit-stage,.challenge-stage) {
      flex:1; width:100%!important; height:100%!important; min-height:0!important; max-height:none!important;
    }
    html.freebbs-native-lab body .page-shell :is(.circuit-stage,.challenge-stage) > svg {
      width:100%!important; height:100%!important; min-height:0!important; min-width:0!important;
    }
    html.freebbs-native-lab body .page-shell :is(.circuit-heading,.circuit-document-heading,.circuit-palette,.circuit-canvas-toolbar,.circuit-viewport-controls,.circuit-canvas-note,.circuit-analysis,.circuit-workbench-actions,.circuit-results,.circuit-sharing,.circuit-model-notes,.challenge-header,.challenge-levels,.challenge-ranking,.challenge-brief,.challenge-waveboard,.challenge-palette,.challenge-inspector,.challenge-canvas-toolbar,.challenge-viewport,#challenge-progress,#challenge-admin-form) { display:none!important; }
    html.freebbs-native-lab body :is(#circuit-run,#circuit-stop,#challenge-run,.circuit-mobile-heading,.circuit-mobile-dock) { display:none!important; }
    html.freebbs-native-lab body .circuit-mobile-zoom {
      display:block!important; top:12px!important; right:12px!important; min-height:36px!important;
      padding:7px 12px!important; border-radius:18px!important; font:13px -apple-system,BlinkMacSystemFont,sans-serif!important;
      font-variant-numeric:tabular-nums; color:var(--ui-text); background:var(--ui-surface);
    }
    html.freebbs-native-lab body .circuit-mobile-feedback {
      position:absolute!important; left:12px!important; right:12px!important; bottom:12px!important;
      height:auto!important; min-height:0!important; max-height:56px!important; padding:8px 12px!important;
      border:0!important; border-radius:14px!important; background:var(--ui-surface); overflow:auto;
    }
    html.freebbs-native-lab body .native-circuit-empty {
      position:absolute; left:50%; top:44%; transform:translate(-50%,-50%); width:min(280px,80%);
      text-align:center; pointer-events:none; font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      color:var(--ui-text); background:var(--ui-page); padding:16px; border-radius:18px;
    }
    html.freebbs-native-lab body .native-circuit-empty strong { font-size:18px; font-weight:600; }
    html.freebbs-native-lab body .native-circuit-empty p { margin-top:8px; font-size:14px; line-height:1.5; color:var(--ui-muted); }
    html.freebbs-native-lab body .native-circuit-empty[hidden] { display:none!important; }
    html.freebbs-native-lab body .circuit-parameter-popover {
      top:auto!important; bottom:12px!important; left:12px!important; right:12px!important;
      width:calc(100% - 24px)!important; max-height:min(65dvh,360px)!important;
      border-radius:20px; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,sans-serif;
    }
    html.freebbs-native-lab body .circuit-parameter-popover[hidden] { display:none!important; }
    html.freebbs-native-lab body .circuit-parameter-popover-arrow { display:none; }
    html.freebbs-native-lab body .circuit-parameter-popover-heading { padding:16px; }
    html.freebbs-native-lab body .circuit-parameter-popover-heading p { font-size:13px; }
    html.freebbs-native-lab body .circuit-parameter-popover-heading h3 { font-size:17px; }
    html.freebbs-native-lab body .circuit-parameter-popover-fields { min-height:100px; padding:12px 16px; }
    html.freebbs-native-lab body .circuit-parameter-popover-fields label { font-size:15px; }
    html.freebbs-native-lab body .circuit-parameter-popover-fields :is(input,select) { min-height:44px; font-size:16px; }
    html.freebbs-native-lab body .circuit-parameter-popover-footer { font-size:12px; padding:8px 16px; }
    html.freebbs-native-lab body .challenge-main.is-empty #challenge-empty { inset:12px!important; }
    """
    static let nativeViewportScript = """
    \(try! String(contentsOf: Bundle.main.url(forResource: "NativeCircuitViewport", withExtension: "js")!, encoding: .utf8))
    document.documentElement.classList.add('freebbs-native-lab');
    // Keep the phone's sheet controls available even when its landscape width exceeds 900pt.
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => nativeMatchMedia(/^\\(max-width:\\s*900px\\)$/.test(query) ? '(min-width: 0px)' : query);
    """
    static let nativeCircuitScript = """
    (() => {
      document.documentElement.classList.add('freebbs-native-lab');
      const style = document.createElement('style'); style.textContent = `\(nativeCircuitCSS)`;
      document.head.append(style);
      const stage = document.querySelector('.circuit-stage,.challenge-stage');
      if (!stage) return;
      let guide;
      if (location.pathname === '/circuit' && !new URLSearchParams(location.search).has('cid')) {
        guide = document.createElement('div'); guide.className='native-circuit-empty';
        guide.innerHTML='<strong>从一个元件开始</strong><p>添加元件与连线，运行后查看波形。</p>';
        stage.parentElement.append(guide);
      }
      let componentIDs = new Set();
      const update = () => {
        const parts = [...stage.querySelectorAll('[data-component-id]')];
        const added = parts.some(part => !componentIDs.has(part.dataset.componentId));
        componentIDs = new Set(parts.map(part=>part.dataset.componentId));
        // Adding a part keeps the canvas clear; tapping it opens the parameter sheet.
        if (added) window.FreeBbsCircuitParameterPopover?.hide();
        const svg = stage.querySelector('svg');
        // The bundled native camera fills both orientations and keeps symbol proportions exact.
        if (svg && svg.getAttribute('preserveAspectRatio') !== 'xMidYMid meet') svg.setAttribute('preserveAspectRatio','xMidYMid meet');
        if (guide) guide.hidden = !!stage.querySelector('[data-component-id]');
      };
      update(); new MutationObserver(update).observe(stage,{childList:true,subtree:true});
    })();
    """
    static let mobileScript = """
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
        html body .page-shell .main-content::before { display:none!important; }
        .lab-heading { align-items:flex-start; gap:12px; margin-bottom:16px; }
        .lab-heading h1 { font-size:26px; }
        .lab-heading p { font-size:16px; line-height:1.5; }
        .lab-eyebrow,body.language-lab-page .lab-heading h1 { display:none; }
        .lab-languages,.lab-result-tabs { flex-wrap:nowrap; overflow-x:auto; padding-bottom:10px; }
        .lab-languages button,.lab-result-tabs button { flex-shrink:0; }
        .lab-workspace,.tool-studio { grid-template-columns:minmax(0,1fr)!important; }
        pre,.lab-wave-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        .circuit-mobile-heading { top:0!important; }
        .has-circuit-mobile-workspace .main-content { padding:0!important; }
        .circuit-mobile-dock { padding-bottom:8px!important; }
      `;
      document.head.append(style);
      // Site styles use highly specific !important rules and insert shell elements late.
      const hideChrome = () => {
        if (document.body.classList.contains('has-mobile-header')) document.body.classList.remove('has-mobile-header');
        const main = document.querySelector('.main-content');
        if (main) {
          main.style.setProperty('margin', '0', 'important');
          main.style.setProperty('padding', document.body.classList.contains('has-circuit-mobile-workspace') ? '0' : '16px', 'important');
        }
        document.querySelectorAll('.topbar,.sidebar,.mobile-nav,.mobile-tools,.desktop-shell-rail,.max-guide-launcher,.mobile-header-backdrop,.site-footer').forEach(node => {
          if (node.style.getPropertyValue('display') !== 'none') node.style.setProperty('display', 'none', 'important');
        });
      };
      hideChrome();
      if (['/circuit','/circuit-challenge'].includes(location.pathname)) {
        \(nativeCircuitScript)
      }
      new MutationObserver(hideChrome).observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['class']});
    })();
    """

}

struct LaboratoryView: View {
    var body: some View {
        List {
            Section("电路") { entries(0..<2) }
            Section("代码与计算") { entries(2..<6) }
            Section("工具工坊") { entries(6..<7) }
        }.listStyle(.insetGrouped).navigationTitle("实验室")
    }
    private func entries(_ range: Range<Int>) -> some View {
        ForEach(Array(range), id: \.self) { index in
            let entry = LabDestination.entries[index]
            NavigationLink {
                LabWorkspaceView(destination: .init(title: entry.0, path: entry.3))
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: entry.2).font(.title2).foregroundStyle(Palette.teal).frame(width: 34)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.0).font(.headline)
                        Text(entry.1).font(.subheadline).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 6)
            }.accessibilityIdentifier("lab-" + entry.3)
        }
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
    nonisolated deinit {}
    var webView: WKWebView?
    var loading = true
    var error: String?
    var progress = 0.0
    var canGoBack = false
    var dialog: LabDialog?
    var presentingDialog = false
    var promptText = ""
    var export: LabExport?
    var discussionDraft: DiscussionDraft?
    var downloadError: String?
    func resolveDialog(_ result: String?) {
        let completion = dialog?.completion
        dialog = nil; presentingDialog = false
        completion?(result)
    }
}

struct LabWorkspaceView: View {
    @Environment(AppStore.self) private var store
    let destination: LabDestination
    var body: some View {
        let url = URL(string: destination.path, relativeTo: URL(string: "https://www.free-bbs.cn"))!
        Group { if url.path == "/code-lab" {
            NativeCodeLabView(destination: destination)
        } else if url.path == "/tool-workshop" {
            NativeToolsView(destination: destination)
        } else if url.path == "/circuits" {
            NativeCircuitLibraryView()
        } else {
            CircuitWorkspaceView(destination: destination)
        } }.id(store.sessionRevision)
    }
}

struct CircuitWorkspaceView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    let destination: LabDestination
    @State private var browser = LabBrowserState()
    @State private var parameters = false
    private var isChallenge: Bool { URL(string: destination.path, relativeTo: store.configuration.origin)?.path == "/circuit-challenge" }
    private var isCircuit: Bool { URL(string: destination.path, relativeTo: store.configuration.origin)?.path == "/circuit" }
    private var actionColor: Color {
        colorScheme == .dark ? Color(red: 0.34, green: 0.82, blue: 0.78) : Color(red: 0, green: 0.43, blue: 0.42)
    }
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
        }.background(Palette.canvas).tint(Palette.teal)
            .navigationTitle(destination.title).navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
            .alert("实验室", isPresented: $browser.presentingDialog, presenting: browser.dialog) { dialog in
                if dialog.kind == .text { TextField("输入内容", text: $browser.promptText) }
                if dialog.kind != .notice { Button("取消", role: .cancel) { browser.resolveDialog(nil) } }
                Button("确定") { browser.resolveDialog(dialog.kind == .text ? browser.promptText : "confirmed") }
            } message: { dialog in Text(dialog.message) }
            .alert("无法导出", isPresented: Binding(get: { browser.downloadError != nil }, set: { if !$0 { browser.downloadError = nil } })) {
                Button("确定", role: .cancel) { browser.downloadError = nil }
            } message: { Text(browser.downloadError ?? "") }
            .sheet(item: $browser.discussionDraft) { draft in
                NavigationStack { ComposeView(title: draft.title, content: draft.content, board: draft.board) }.environment(store)
            }
            .sheet(isPresented: $parameters) { NavigationStack { CircuitParametersView(browser: browser) } }
            .sheet(item: $browser.export, onDismiss: { browser.export = nil }) { item in
                LabShareSheet(url: item.url)
            }
            .onDisappear { browser.resolveDialog(nil) }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if isCircuit {
                        Button { parameters = true } label: { Image(systemName: "slider.horizontal.3") }
                            .disabled(browser.loading || store.isDemo).accessibilityLabel("电路参数")
                        Menu {
                            Button("添加元件", systemImage: "plus") { click("circuit-component-add") }
                            Button("保存电路", systemImage: "square.and.arrow.down") { click("circuit-save") }
                            Button("分享至讨论", systemImage: "bubble.left") { click("circuit-publish") }
                            Button("元件参数", systemImage: "slider.horizontal.3") { panel("parameters") }
                            Button("波形与读数", systemImage: "waveform.path") { panel("waves") }
                            Button("示例、版本与导入导出", systemImage: "square.stack") { panel("more") }
                            Button("取消接线", systemImage: "xmark") { click("circuit-cancel-wire") }
                            Button("整理布局", systemImage: "wand.and.stars") { click("circuit-beautify") }
                            Button("撤销", systemImage: "arrow.uturn.backward") { click("circuit-undo") }
                            Button("重做", systemImage: "arrow.uturn.forward") { click("circuit-redo") }
                            Button("重置缩放", systemImage: "arrow.up.left.and.arrow.down.right") { click("circuit-zoom-reset") }
                            Button("显示完整电路", systemImage: "viewfinder") { fitCircuit() }
                            Button("刷新工作区", systemImage: "arrow.clockwise") { browser.webView?.reload() }
                        } label: { Image(systemName: "ellipsis") }.disabled(browser.loading || store.isDemo).accessibilityLabel("电路操作")
                    } else if isChallenge {
                        Menu {
                            Button("选择关卡", systemImage: "list.number") { panel("levels") }
                            Button("排行榜", systemImage: "trophy") { panel("ranking") }
                            Button("添加元件", systemImage: "plus") { panel("parts") }
                            Button("元件参数", systemImage: "slider.horizontal.3") { panel("parameters") }
                            Button("波形", systemImage: "waveform.path") { panel("waves") }
                            Button("工具与设置", systemImage: "ellipsis") { panel("more") }
                            Button("撤销", systemImage: "arrow.uturn.backward") { click("challenge-undo") }
                            Button("取消接线", systemImage: "xmark") { click("challenge-cancel-wire") }
                        } label: { Image(systemName: "ellipsis") }.disabled(browser.loading || store.isDemo).accessibilityLabel("挑战操作")
                    } else {
                        Button { browser.webView?.goBack() } label: { Image(systemName: "chevron.backward") }
                            .disabled(!browser.canGoBack).accessibilityLabel("返回上一实验页面")
                    }
                    if !isCircuit {
                        Button { browser.error = nil; browser.webView?.reload() } label: { Image(systemName: "arrow.clockwise") }
                            .accessibilityLabel("刷新实验室")
                    }
                }
                if isCircuit || isChallenge {
                    ToolbarItemGroup(placement: .bottomBar) {
                        if isCircuit {
                            Button { click("circuit-component-add") } label: { HStack(spacing: 6) { Image(systemName: "plus"); Text("元件") }.foregroundStyle(actionColor) }
                                .disabled(browser.loading || store.isDemo).accessibilityIdentifier("addCircuitComponent")
                        }
                        Button { click(isCircuit ? "circuit-run" : "challenge-run") } label: { HStack(spacing: 6) { Image(systemName: "play.fill"); Text("运行") }.foregroundStyle(actionColor) }
                            .disabled(browser.loading || store.isDemo).accessibilityIdentifier("runCircuit")
                        if isCircuit { Button { click("circuit-stop") } label: { Image(systemName: "stop.fill").foregroundStyle(actionColor) }.accessibilityLabel("停止仿真").disabled(browser.loading || store.isDemo) }
                        else { Button("重置", systemImage: "arrow.counterclockwise") { click("challenge-reset") }.disabled(browser.loading || store.isDemo) }
                    }
                }
            }
    }
    private func fitCircuit() {
        browser.webView?.evaluateJavaScript("document.getElementById('circuit-stage')?.dispatchEvent(new Event('freebbs-native-fit'))", completionHandler: nil)
    }
    private func panel(_ name: String) {
        let sidebar = name == "parameters" && isCircuit
        let function = sidebar ? "FreeBbsCircuitSidebar" : "FreeBbsCircuitMobile"
        browser.webView?.evaluateJavaScript("if(['/circuit','/circuit-challenge'].includes(location.pathname)) window.\(function)?.\(sidebar ? "open" : "show")(\(WebContentPolicy.json(name)))", completionHandler: nil)
    }
    private func click(_ id: String) {
        guard let web = browser.webView else { return }
        web.evaluateJavaScript("if(['/circuit','/circuit-challenge'].includes(location.pathname)) document.getElementById(\(WebContentPolicy.json(id)))?.click()", completionHandler: nil)
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
        config.userContentController.addUserScript(.init(source: WebContentPolicy.mobileScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator; web.uiDelegate = context.coordinator
        web.isOpaque = false; web.backgroundColor = .clear
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.keyboardDismissMode = .interactive
        web.scrollView.contentInsetAdjustmentBehavior = .never
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
            if WebContentPolicy.sameOrigin(url, origin: parent.origin), ["/publish", "/discussion"].contains(url.path) {
                handoffDiscussion(url, web: webView); return
            }
            if WebContentPolicy.sameOrigin(url, origin: parent.origin), ["/login", "/register"].contains(url.path) { parent.login() }
            else if action.navigationType == .linkActivated, AppConfiguration.safeLink(url.absoluteString, origin: parent.origin) != nil { UIApplication.shared.open(url) }
        }
        private func handoffDiscussion(_ url: URL, web: WKWebView) {
            guard parent.token != nil else { parent.login(); return }
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            func value(_ key: String) -> String? {
                let matches = items.filter { $0.name == key }
                return matches.count == 1 ? matches[0].value : nil
            }
            if url.path == "/discussion", value("compose") == "circuit",
               let cid = value("cid"), cid.range(of: "^c_[a-f0-9]{24}$", options: .regularExpression) != nil,
               let revision = value("revision"), revision.range(of: "^[1-9][0-9]{0,8}$", options: .regularExpression) != nil {
                var link = URLComponents(url: parent.origin, resolvingAgainstBaseURL: false)!
                link.path = "/circuit"; link.queryItems = [.init(name: "cid", value: cid), .init(name: "revision", value: revision), .init(name: "view", value: "live")]
                if let target = link.url {
                    parent.browser.discussionDraft = DiscussionDraft(title: "分享电路实验", content: "[查看电路与仿真](\(target.absoluteString))\n\n我的观察：\n", board: "circuit")
                }
                return
            }
            guard url.path == "/publish" else { return }
            let key: String
            if value("lab_share") == "1" { key = "free_bbs_lab_share_draft" }
            else if value("tool_share") == "1" { key = "free_bbs_tool_share_draft" }
            else { return }
            web.callAsyncJavaScript("return sessionStorage.getItem(key)", arguments: ["key":key], in: nil, in: .page) { [weak self, weak web] result in
                guard let self, let web, self.parent.browser.webView === web,
                      case .success(let value) = result, let raw = value as? String, raw.utf8.count <= 100000,
                      let data = raw.data(using: .utf8),
                      let draft = try? JSONSerialization.jsonObject(with: data) as? [String:Any],
                      let title = draft["title"] as? String, title.count <= 120,
                      let content = draft["content"] as? String, !content.isEmpty, content.count <= 20000 else { return }
                self.parent.browser.discussionDraft = DiscussionDraft(title: title, content: content, board: "daily")
            }
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

struct LabShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
