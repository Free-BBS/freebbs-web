import SwiftUI

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = 0
    @AppStorage("freebbs.native.theme") private var theme = "system"
    var body: some View {
        @Bindable var store = store
        TabView(selection: $tab) {
            Tab("今日", systemImage: "sun.max", value: 0) { NavigationStack { HomeView() } }
            Tab("课程", systemImage: "square.stack.3d.up", value: 1) { NavigationStack { CoursesView() } }
            Tab("讨论", systemImage: "bubble.left.and.bubble.right", value: 2) { NavigationStack { DiscussionView() } }
            Tab("实验室", systemImage: "flask", value: 3) { NavigationStack { LaboratoryView() } }
            Tab("我的", systemImage: "person.crop.circle", value: 4) { NavigationStack { ProfileView() } }
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
