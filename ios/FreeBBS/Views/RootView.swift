import SwiftUI

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = "/"
    @AppStorage("freebbs.native.theme") private var theme = "system"
    var body: some View {
        @Bindable var store = store
        TabView(selection: $tab) {
            ForEach(FeatureCatalog.navigation.primary) { item in
                Tab(item.title.isEmpty ? "发布" : item.title, systemImage: item.path == "/publish" ? "plus" : item.symbol, value: item.path) {
                    NavigationStack {
                        switch item.path {
                        case "/": HomeView()
                        case "/discussion": DiscussionView()
                        case "/publish": WebsiteMenuView(kind: .create)
                        case "/world": WebsiteMenuView(kind: .learning)
                        default: WebsiteMenuView(kind: .tools)
                        }
                    }
                }
            }
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
}
