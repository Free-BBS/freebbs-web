import SwiftUI

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = "/"
    @AppStorage("freebbs.native.theme") private var theme = "system"
    @State private var path: [FeatureDestination] = []
    @State private var navigationRevision = 0
    @State private var searching = false
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    var body: some View {
        @Bindable var store = store
        VStack(spacing: 0) {
            NavigationStack(path: $path) {
                Group {
                    if searching { NativeSearchView(query: $query, onOpen: { searchFocused = false }) }
                    else if tab == "/discussion" { DiscussionView() }
                    else { HomeView() }
                }
                .navigationDestination(for: FeatureDestination.self) { destination in Group {
                        switch destination.path {
                        case "/native-features": FeaturesView()
                        case "/native-inbox": InboxView()
                        case "/native-support": SupportView()
                        default: FeatureWorkspaceView(destination: destination)
                        }
                    } }
            }
            .id(navigationRevision)
            bottomBar.fixedSize(horizontal: false, vertical: true)
        }
        .preferredColorScheme(theme == "dark" ? .dark : theme == "light" ? .light : nil)
        .sheet(isPresented: Binding(get: { store.showLogin && store.featureDestination == nil }, set: { store.showLogin = $0 })) { NavigationStack { AuthenticationView() }.environment(store) }
        .sheet(item: $store.featureDestination) { destination in
            NavigationStack {
                FeatureWorkspaceView(destination: destination)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { store.featureDestination = nil } } }
            }.environment(store)
                .sheet(isPresented: $store.showLogin) { NavigationStack { AuthenticationView() }.environment(store) }
        }
        .alert("暂时无法完成", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("知道了", role: .cancel) { store.error = nil }
        } message: { Text(store.error ?? "") }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.refreshInbox() } }
        }
    }
    private var bottomBar: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                if searching {
                    Button { withAnimation { searching = false; searchFocused = false; path = []; navigationRevision += 1; query = "" } } label: {
                        Image(systemName: "chevron.backward").frame(width: 48, height: 48)
                    }.accessibilityLabel("返回导航").glassEffect(.regular.interactive(), in: Circle())
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("搜索 FREE-BBS", text: $query).focused($searchFocused).submitLabel(.search)
                            .onSubmit { searchFocused = false }.accessibilityIdentifier("globalSearchField")
                        if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.accessibilityLabel("清除搜索") }
                    }.padding(.horizontal, 16).frame(minHeight: 48).glassEffect(.regular, in: Capsule())
                } else {
                    HStack(spacing: 0) {
                        bottomItem("首页", symbol: "house", selected: tab == "/") { tab = "/"; path = []; navigationRevision += 1 }
                        bottomItem("讨论", symbol: "bubble.left.and.bubble.right", selected: tab == "/discussion") { tab = "/discussion"; path = []; navigationRevision += 1 }
                        Menu {
                            ForEach(FeatureCatalog.navigation.create) { item in menuAction(item) }
                        } label: {
                            Image(systemName: "plus").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                                .frame(width: 38, height: 38).background(Palette.teal, in: Circle())
                                .frame(maxWidth: .infinity).frame(minHeight: 52)
                        }.accessibilityLabel("发布").accessibilityIdentifier("bottom-publish")
                        Menu {
                            ForEach(FeatureCatalog.navigation.learning) { item in menuAction(item) }
                        } label: { bottomLabel("学习", symbol: "map") }.accessibilityIdentifier("bottom-learning")
                        Menu {
                            if store.user == nil { Button("登录 / 注册", systemImage: "person.crop.circle") { store.showLogin = true } }
                            ForEach(FeatureCatalog.navigation.tools) { item in menuAction(item) }
                            Divider()
                            Button("通知中心", systemImage: "bell") { open("/native-inbox", title: "通知中心") }
                            Button("个人主页", systemImage: "person.crop.circle") { open("/profile", title: "个人主页") }
                            Button("仓库", systemImage: "shippingbox") { open("/inventory", title: "仓库") }
                            Button("电磁场商城", systemImage: "bag") { open("/electromagnetic", title: "电磁场商城") }
                            if store.user?.isAdmin == true { Button("管理员端", systemImage: "gearshape") { open("/system-settings", title: "管理员端") } }
                            Divider()
                            Button("所有功能", systemImage: "square.grid.2x2") { open("/native-features", title: "所有功能") }
                            Button("新手导引", systemImage: "sparkles") { open("/guide", title: "新手导引") }
                            Button("帮助与联系", systemImage: "questionmark.circle") { open("/native-support", title: "帮助与联系") }
                        } label: { bottomLabel("工具", symbol: "slider.horizontal.3") }.accessibilityIdentifier("bottom-tools")
                    }.padding(.horizontal, 5).glassEffect(.regular, in: Capsule())
                    Button {
                        withAnimation { searching = true; path = []; navigationRevision += 1 }; searchFocused = true
                    } label: { Image(systemName: "magnifyingglass").font(.title3.weight(.semibold)).frame(width: 48, height: 52) }
                        .accessibilityLabel("全站搜索").accessibilityIdentifier("bottom-search")
                        .glassEffect(.regular.interactive(), in: Capsule())
                }
            }.padding(.horizontal, 12).padding(.vertical, 6)
        }.tint(Palette.teal)
    }
    private func bottomItem(_ title: String, symbol: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { bottomLabel(title, symbol: selected ? symbol + ".fill" : symbol) }
            .foregroundStyle(selected ? Palette.teal : Color.primary)
            .accessibilityIdentifier("bottom-" + (title == "首页" ? "home" : "discussion"))
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
    private func bottomLabel(_ title: String, symbol: String) -> some View {
        VStack(spacing: 3) { Image(systemName: symbol).font(.system(size: 19, weight: .medium)); Text(title).font(.caption2.weight(.medium)).lineLimit(1).minimumScaleFactor(0.75) }
            .frame(maxWidth: .infinity).frame(minHeight: 52).contentShape(Rectangle()).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
    private func menuAction(_ item: SiteNavigationItem) -> some View {
        Button(item.title, systemImage: item.symbol) { open(item.path, title: item.title) }
            .accessibilityIdentifier("menu-" + item.path)
    }
    private func open(_ route: String, title: String) { searchFocused = false; path.append(.init(path: route, title: title)) }

}
