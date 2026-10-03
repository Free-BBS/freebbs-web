import SwiftUI

struct FeaturesView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @FocusState private var searchFocused: Bool
    private var matching: [SiteFeature] {
        FeatureCatalog.entries.filter { feature in
            FeatureCatalog.visible(feature, user: store.user) &&
            (search.isEmpty || (feature.title + feature.detail + feature.group).localizedCaseInsensitiveContains(search))
        }
    }
    var body: some View {
        List {
            ForEach(FeatureCatalog.groups, id: \.self) { group in
                let features = matching.filter { $0.group == group }
                if !features.isEmpty {
                    Section(group) {
                        ForEach(features) { feature in
                            NavigationLink {
                                FeatureWorkspaceView(destination: .init(feature))
                            } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: feature.symbol).font(.title3).foregroundStyle(Palette.teal).frame(width: 30)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(feature.title).font(.headline)
                                        Text(feature.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                    if feature.login && store.user == nil { Image(systemName: "lock").font(.caption).foregroundStyle(.secondary) }
                                }.padding(.vertical, 5)
                            }.accessibilityIdentifier("feature-" + feature.path)
                        }
                    }
                }
            }
            if matching.isEmpty {
                ContentUnavailableView.search(text: search)
            }
        }.listStyle(.insetGrouped).navigationTitle("所有功能")
            .scrollDismissesKeyboard(.interactively)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "查找功能、工作区或设置")
            .searchFocused($searchFocused)
            .onSubmit(of: .search) { searchFocused = false }
    }
}

struct FeatureLink: View {
    let path: String
    var title: String? = nil
    var body: some View {
        if let feature = FeatureCatalog.entries.first(where: { $0.path == path }) {
            NavigationLink {
                FeatureWorkspaceView(destination: .init(path: path, title: title ?? feature.title))
            } label: { Label(title ?? feature.title, systemImage: feature.symbol).frame(minHeight: 44) }
                .accessibilityIdentifier("feature-" + path)
        }
    }
}

struct FeatureWorkspaceView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    let destination: FeatureDestination
    @State private var browser = LabBrowserState()
    private var feature: SiteFeature? {
        URL(string: destination.path, relativeTo: store.configuration.origin).flatMap { FeatureCatalog.feature(for: $0) }
    }
    var body: some View {
        Group {
            if feature?.admin == true && store.user?.isAdmin != true {
                ContentUnavailableView("需要管理权限", systemImage: "lock.shield", description: Text("请使用具备对应权限的账号。"))
            } else if feature?.login == true && store.user == nil {
                ContentUnavailableView {
                    Label("登录后继续", systemImage: "person.crop.circle")
                } description: { Text(destination.title) } actions: {
                    Button("登录或注册") { store.showLogin = true }.buttonStyle(.borderedProminent)
                }
            } else if feature?.path == "/markdown-editor", URLComponents(string: destination.path)?.queryItems?.contains(where: { $0.name == "point" && $0.value?.isEmpty == false }) != true {
                MarkdownDocumentPicker()
            } else if feature?.native == true {
                nativeDestination
            } else {
                workspace
            }
        }.navigationTitle(browser.pageTitle ?? destination.title).navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
            .navigationDestination(item: $browser.nextFeature) { FeatureWorkspaceView(destination: $0) }
            .onDisappear { browser.resolveDialog(nil); browser.resolveConsent(false); browser.resolveFiles(nil) }
    }
    @ViewBuilder private var nativeDestination: some View {
        switch feature?.path {
        case "/": HomeView()
        case "/login": AuthenticationView()
        case "/register": AuthenticationView(initialMode: .register)
        case "/remake": AuthenticationView(initialMode: .reset)
        case "/laboratory": LaboratoryView()
        default: LabWorkspaceView(destination: destination.lab)
        }
    }
    private var workspace: some View {
        VStack(spacing: 0) {
            if store.isDemo {
                ContentUnavailableView("工作区预览", systemImage: feature?.symbol ?? "globe", description: Text("正式版本连接完整工作区。预览模式不读取或更改线上账号数据。"))
            } else {
                if browser.loading { ProgressView(value: browser.progress).tint(Palette.teal) }
                if let error = browser.error {
                    ContentUnavailableView { Label("暂时无法加载", systemImage: "wifi.exclamationmark") }
                    description: { Text(error) } actions: {
                        Button("重试") { browser.error = nil; browser.webView?.reload() }.buttonStyle(.borderedProminent)
                    }
                }
                LabWebView(destination: destination.lab, origin: store.configuration.origin,
                           token: store.api.token, dark: colorScheme == .dark, browser: browser,
                           login: { store.showLogin = true }, includeFeatures: true, store: store)
                    .id(store.sessionRevision).opacity(browser.error == nil ? 1 : 0)
                    .frame(maxWidth: .infinity, maxHeight: browser.error == nil ? .infinity : 0)
            }
        }.background(Palette.canvas)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("返回上一页", systemImage: "chevron.backward") { browser.webView?.goBack() }.disabled(!browser.canGoBack)
                        Button("前进", systemImage: "chevron.forward") { browser.webView?.goForward() }.disabled(browser.webView?.canGoForward != true)
                        Button("刷新", systemImage: "arrow.clockwise") { browser.error = nil; browser.webView?.reload() }
                        if browser.hasAccountUtilities {
                            Button("签到日历与运势", systemImage: "calendar.badge.checkmark") { browser.webView?.evaluateJavaScript("window.freeBbsApp.openFortuneModal()") }
                            Button("资产说明", systemImage: "bolt.circle") { browser.webView?.evaluateJavaScript("window.openElectromagneticModal()") }
                        }
                        FeatureLink(path: "/inventory", title: "仓库与钱包账本")
                        NavigationLink { FeaturesView() } label: { Label("所有功能", systemImage: "square.grid.2x2") }
                        if let url = browser.webView?.url, FeatureCatalog.pageURL(url, origin: store.configuration.origin) {
                            ShareLink(item: url) { Label("分享页面", systemImage: "square.and.arrow.up") }
                        }
                    } label: { Image(systemName: "ellipsis") }.accessibilityLabel("工作区操作")
                }
            }
            .alert("FREE-BBS", isPresented: $browser.presentingDialog, presenting: browser.dialog) { dialog in
                if dialog.kind == .text { TextField("输入内容", text: $browser.promptText) }
                if dialog.kind != .notice { Button("取消", role: .cancel) { browser.resolveDialog(nil) } }
                Button("确定") { browser.resolveDialog(dialog.kind == .text ? browser.promptText : "confirmed") }
            } message: { Text($0.message) }
            .confirmationDialog("允许 Max 处理发送的内容？", isPresented: $browser.presentingConsent, titleVisibility: .visible) {
                Button("同意并继续") { store.aiConsent = true; browser.resolveConsent(true) }
                Button("取消", role: .cancel) { browser.resolveConsent(false) }
            } message: {
                Text("你发送的问题、上下文、附件和制作需求会交由 FREE-BBS 配置的 AI 服务处理。此选择按账号在本机保存，可在「我的」撤回。")
            }
            .siteFileImport(browser: browser)
            .sheet(item: $browser.export) { item in LabShareSheet(url: item.url) }
            .sheet(item: $browser.authorization) { request in
                ConnectedAccountAuthorization(request: request) { url in
                    browser.authorization = nil
                    if let url { browser.webView?.load(URLRequest(url: url)) }
                }.environment(store)
            }
            .alert("无法打开文件", isPresented: Binding(get: { browser.downloadError != nil }, set: { if !$0 { browser.downloadError = nil } })) {
                Button("确定", role: .cancel) { browser.downloadError = nil }
            } message: { Text(browser.downloadError ?? "") }
    }
}
