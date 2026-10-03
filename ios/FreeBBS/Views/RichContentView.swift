import SwiftUI
import WebKit

enum RichContentEngine {
    static let document: String = {
        guard let url = Bundle.main.url(forResource: "RichContent", withExtension: "html"),
              let source = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return source
    }()
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
    var body: some View {
        RichWebView(source: source, origin: store.configuration.origin, token: store.isDemo ? nil : store.api.token,
                    dark: colorScheme == .dark, fontSize: fontSize, allowReferences: !store.isDemo, height: $height,
                    link: open, copy: { value in UIPasteboard.general.string = value; copied = true })
            .id(store.sessionRevision).frame(height: height)
            .accessibilityIdentifier("richContent")
            .overlay(alignment: .topTrailing) {
                if copied { Text("已复制").font(.caption).padding(8).background(.regularMaterial, in: Capsule())
                        .task { try? await Task.sleep(for: .seconds(2)); copied = false } }
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
        else { UIApplication.shared.open(url) }
    }
}

private struct RichWebView: UIViewRepresentable {
    let source: String
    let origin: URL
    let token: String?
    let dark: Bool
    let fontSize: Double
    let allowReferences: Bool
    @Binding var height: Double
    let link: (String) -> Void
    let copy: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(context.coordinator, name: "reader")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false; web.backgroundColor = .clear; web.scrollView.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false
        web.navigationDelegate = context.coordinator
        web.loadHTMLString(RichContentEngine.document, baseURL: origin)
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.render(web)
    }
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.stopLoading(); web.navigationDelegate = nil
        web.configuration.userContentController.removeScriptMessageHandler(forName: "reader")
    }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: RichWebView
        var ready = false
        var renderedKey = ""
        init(_ parent: RichWebView) { self.parent = parent }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { ready = true; render(webView) }
        func render(_ web: WKWebView) {
            let key = parent.source + "|\(parent.dark)|\(parent.fontSize)|\(parent.allowReferences)"
            guard ready, key != renderedKey else { return }
            renderedKey = key
            web.callAsyncJavaScript("window.renderNativeContent(source, origin, token, dark, fontSize, allowReferences)",
                arguments: ["source":parent.source, "origin":parent.origin.absoluteString, "token":parent.token ?? "", "dark":parent.dark,
                            "fontSize":parent.fontSize, "allowReferences":parent.allowReferences], in: nil, in: .page) { [weak self] result in
                if case .failure = result { self?.renderedKey = "" }
            }
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            // Opaque tool frames have no access to native clipboard, navigation or sizing.
            guard message.frameInfo.isMainFrame, let data = message.body as? [String: Any] else { return }
            if data["type"] as? String == "height", let value = data["value"] as? Double, value.isFinite {
                let next = max(24, min(200000, value))
                if abs(parent.height - next) > 1 { parent.height = next }
            } else if data["type"] as? String == "link", let value = data["value"] as? String { parent.link(value) }
            else if data["type"] as? String == "copy", let value = data["value"] as? String, value.count <= 50000 { parent.copy(value) }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            if action.navigationType == .other, let url = action.request.url,
               url.absoluteString == "about:blank" || WebContentPolicy.sameOrigin(url, origin: parent.origin) {
                decisionHandler(.allow); return
            }
            decisionHandler(.cancel)
            if let url = action.request.url { parent.link(url.absoluteString) }
        }
    }
}
