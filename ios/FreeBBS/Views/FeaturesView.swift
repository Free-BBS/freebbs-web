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
    let destination: FeatureDestination
    private var feature: SiteFeature? {
        NativeRoutes.url(destination, origin: store.configuration.origin).flatMap { FeatureCatalog.feature(for: $0) }
    }
    var body: some View {
        Group {
            if NativeRoutes.url(destination, origin: store.configuration.origin).map(FeatureCatalog.unavailableOnPhone) == true || feature == nil {
                ContentUnavailableView("此功能暂未在 iPhone 开放", systemImage: "iphone")
            } else if feature?.admin == true && store.user?.isAdmin != true {
                ContentUnavailableView("需要管理权限", systemImage: "lock.shield", description: Text("请使用具备对应权限的账号。"))
            } else if feature?.login == true && store.user == nil {
                NativeAccountRequired()
            } else { nativeDestination }
        }.navigationTitle(destination.title).navigationBarTitleDisplayMode(.inline)
            .id(destination.path + String(store.sessionRevision))
    }
    @ViewBuilder private var nativeDestination: some View {
        switch feature?.path {
        case "/": HomeView()
        case "/login": AuthenticationView()
        case "/register": AuthenticationView(initialMode: .register)
        case "/remake": AuthenticationView(initialMode: .reset)
        case "/world", "/course", "/knowledge": NativeCourseDestination(destination: destination)
        case "/course-map-editor": NativeCourseMapEditor(destination: destination)
        case "/markdown-editor":
            if NativeRoutes.query(destination, "point")?.isEmpty == false { NativeDocumentEditor(destination: destination) }
            else { MarkdownDocumentPicker() }
        case "/search": NativeSearchPage()
        case "/workbench": NativeWorkbenchView()
        case "/surveys": NativeSurveysView(surveyID: NativeRoutes.query(destination, "id"))
        case "/discussion":
            if let id = NativeRoutes.query(destination, "post") { PostDetailView(postID: id) }
            else { DiscussionView() }
        case "/publish": ComposeView()
        case "/aichat": ChatView()
        case "/laboratory": LaboratoryView()
        case "/circuits", "/circuit", "/circuit-embed", "/circuit-challenge": LabWorkspaceView(destination: destination.lab)
        case "/code-lab": NativeCodeLabView(destination: destination.lab)
        case "/tool-workshop": NativeToolsView(destination: destination.lab)
        case "/profile": NativePublicProfileView(uid: NativeRoutes.query(destination, "uid"))
        case "/settings": NativeSettingsView()
        case "/electromagnetic": NativeEconomyView()
        case "/inventory": NativeEconomyView(inventory: true)
        case "/ranch": NativeRanchView(uid: NativeRoutes.query(destination, "uid"))
        case "/ranch-gallery": NativeRanchView(gallery: true)
        case "/ranch-dye": NativeDyeView()
        case "/guide": NativeGuideView()
        case "/about", "/pbl", "/creative-workshop": NativeInformationView(path: feature!.path, title: destination.title)
        case "/staff": NativeStaffView()
        case "/adminusers": NativeAdminUsersView()
        case "/system-settings": NativeAdministrationView()
        case "/system-settings/model": NativeAdminSettingsView()
        case "/system-settings/course-materials": NativeAdminSettingsView(materials: true)
        case "/system-settings/announcements": NativeAdminPublication()
        case "/system-settings/rewards": NativeAdminPublication(rewards: true)
        case "/system-settings/surveys": NativeAdminSurveys()
        default: ContentUnavailableView("页面不存在", systemImage: "questionmark.folder")
        }
    }
}

// The website's mobile menus provide the order and labels; SwiftUI provides
// the navigation, scrolling, typography, safe areas and system glass chrome.
struct WebsiteMenuView: View {
    enum Kind { case create, learning, tools }
    @Environment(AppStore.self) private var store
    let kind: Kind
    private var items: [SiteNavigationItem] {
        switch kind {
        case .create: FeatureCatalog.navigation.create
        case .learning: FeatureCatalog.navigation.learning
        case .tools: FeatureCatalog.navigation.tools
        }
    }
    private var title: String {
        switch kind { case .create: "发布"; case .learning: "学习"; case .tools: "工具" }
    }
    var body: some View {
        List {
            if kind == .learning {
                Section { ForEach(items.prefix(1)) { menuRow($0) } }
                Section("探索与实践") { ForEach(items.dropFirst()) { menuRow($0) } }
            } else {
                Section {
                    if kind == .tools && store.user == nil {
                        Button { store.showLogin = true } label: { Label("登录 / 注册", systemImage: "person.crop.circle").frame(minHeight: 44) }
                    }
                    ForEach(items) { menuRow($0) }
                }
            }
            if kind == .tools {
                Section {
                    if store.user?.isAdmin == true { FeatureLink(path: "/system-settings") }
                    NavigationLink { InboxView() } label: { Label("通知中心", systemImage: "bell.badge") }
                        .accessibilityIdentifier("menu-inbox")
                }
                Section("个人空间") {
                    FeatureLink(path: "/profile")
                    FeatureLink(path: "/inventory", title: "仓库")
                    FeatureLink(path: "/electromagnetic", title: "电磁场")
                }
                Section {
                    NavigationLink { FeaturesView() } label: { Label("所有功能", systemImage: "square.grid.2x2") }
                    FeatureLink(path: "/guide")
                    NavigationLink { SupportView() } label: { Label("帮助与联系", systemImage: "questionmark.circle") }
                }
            }
        }.listStyle(.insetGrouped).navigationTitle(title)
    }
    private func menuRow(_ item: SiteNavigationItem) -> some View {
        NavigationLink {
            switch item.path {
            case "/world": CoursesView().navigationTitle("学习世界")
            case "/laboratory": LaboratoryView()
            case "/settings": NativeSettingsView()
            default: FeatureWorkspaceView(destination: .init(path: item.path, title: item.title))
            }
        } label: {
            Label(item.title, systemImage: item.symbol).frame(minHeight: 44)
        }.accessibilityIdentifier("menu-" + item.path)
    }

}
