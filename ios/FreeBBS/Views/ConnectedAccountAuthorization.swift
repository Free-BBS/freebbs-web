import SwiftUI
import WebKit

struct ConnectorAuthorization: Identifiable {
    let id = UUID()
    let url: URL
}

enum ConnectorAuthorizationPolicy {
    static func permits(_ url: URL) -> Bool {
        url.scheme == "https" && url.host != nil && url.user == nil && url.password == nil
    }
    static func isCallback(_ url: URL, origin: URL) -> Bool {
        guard WebContentPolicy.sameOrigin(url, origin: origin), url.path == "/workbench" else { return false }
        let connectors = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.filter { $0.name == "connector" } ?? []
        return connectors.count == 1 && connectors.first?.value == "tsinghua"
    }
}

struct ConnectedAccountAuthorization: View {
    @Environment(AppStore.self) private var store
    let request: ConnectorAuthorization
    let completed: (URL?) -> Void
    @State private var error: String?
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary).padding() }
                ConnectorAuthorizationWeb(url: request.url, origin: store.configuration.origin,
                                          dataStore: store.featureDataStore, error: $error, completed: completed)
            }.navigationTitle("连接校园账号").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { completed(nil) } } }
        }
    }
}

private struct ConnectorAuthorizationWeb: UIViewRepresentable {
    let url: URL
    let origin: URL
    let dataStore: WKWebsiteDataStore
    @Binding var error: String?
    let completed: (URL?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Preserve the first-party correlation cookie. Authorization pages have
        // no injected login token, user scripts or native message handlers.
        config.websiteDataStore = dataStore
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator; web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.load(URLRequest(url: url)); return web
    }
    func updateUIView(_ web: WKWebView, context: Context) { context.coordinator.parent = self }
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) { web.stopLoading(); web.navigationDelegate = nil; web.uiDelegate = nil }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: ConnectorAuthorizationWeb
        private var returned = false
        init(_ parent: ConnectorAuthorizationWeb) { self.parent = parent }
        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, ConnectorAuthorizationPolicy.permits(url) else { decisionHandler(.cancel); return }
            if action.targetFrame?.isMainFrame != false, ConnectorAuthorizationPolicy.isCallback(url, origin: parent.origin) {
                // Deliver the original callback before the website consumes its
                // result query using history.replaceState at DOMContentLoaded.
                decisionHandler(.cancel)
                if !returned { returned = true; parent.completed(url) }
                return
            }
            decisionHandler(.allow)
        }
        func webView(_ web: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url, ConnectorAuthorizationPolicy.permits(url) { web.load(action.request) }
            return nil
        }
        func webView(_ web: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { parent.error = error.localizedDescription }
        }
    }
}
