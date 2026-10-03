import SwiftUI

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = 0
    var body: some View {
        @Bindable var store = store
        TabView(selection: $tab) {
            Tab("今日", systemImage: "sun.max", value: 0) { NavigationStack { HomeView() } }
            Tab("课程", systemImage: "square.stack.3d.up", value: 1) { NavigationStack { CoursesView() } }
            Tab("讨论", systemImage: "bubble.left.and.bubble.right", value: 2) { NavigationStack { DiscussionView() } }
            Tab("通知", systemImage: "bell", value: 3) { NavigationStack { InboxView() } }.badge(store.unreadCount)
            Tab("我的", systemImage: "person.crop.circle", value: 4) { NavigationStack { ProfileView() } }
        }
        .sheet(isPresented: $store.showLogin) { NavigationStack { AuthenticationView() }.environment(store) }
        .alert("暂时无法完成", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("知道了", role: .cancel) { store.error = nil }
        } message: { Text(store.error ?? "") }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.refreshInbox() } }
        }
    }
}
