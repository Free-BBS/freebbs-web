import SwiftUI

struct NativeDiscussionControls: View {
    @Environment(AppStore.self) private var store
    let postID: String
    @State private var state = NativeWorkspace()
    private var post: SiteRecord { state.data["post"] }
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            Section("讨论") { Text(post["title"].text).font(.headline) }
            Section("可见范围") {
                if post["canHide"].flag {
                    Toggle("隐藏帖子", isOn: Binding(get: { post["isHidden"].flag }, set: { value in Task { await change("visibility", body: ["hidden": value]) } }))
                    Toggle("登录后可见", isOn: Binding(get: { post["loginRequired"].flag }, set: { value in Task { await change("login-required", body: ["loginRequired": value]) } }))
                } else { Text(post["loginRequired"].flag ? "登录后可见" : "公开可见").foregroundStyle(.secondary) }
            }
            if post["canPin"].flag || post["canFeature"].flag { Section("版块管理") {
                if post["canPin"].flag { Toggle("置顶", isOn: Binding(get: { post["isPinned"].flag }, set: { value in Task { await change("pin", body: ["pinned": value]) } })) }
                if post["canFeature"].flag { Toggle("精华", isOn: Binding(get: { post["isFeatured"].flag }, set: { value in Task { await change("feature", body: ["featured": value]) } })) }
            }.disabled(state.busy) }
            if store.user?.isAdmin == true && post["isAnonymous"].flag {
                Section { NavigationLink { NativeAnonymousAuthor(postID: postID) } label: { Label("核验匿名发帖人", systemImage: "person.badge.shield.checkmark") } }
            }
        }.navigationTitle("讨论操作").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { await load() }
    }
    private func load() async { await state.load(store, path: "/api/discussion/posts/" + NativeRoutes.component(postID)) }
    private func change(_ action: String, body: [String: Any]) async {
        if await state.mutate(store, path: "/api/discussion/posts/\(NativeRoutes.component(postID))/\(action)", method: "PATCH", body: body) != nil { await load(); await store.refreshPosts() }
    }
}
struct NativeAnonymousAuthor: View {
    @Environment(AppStore.self) private var store
    let postID: String
    @State private var state = NativeWorkspace()
    var body: some View {
        Form { WorkspaceStatus(state: state); LabeledContent("用户名", value: state.data["author"]["username"].text); LabeledContent("UID", value: state.data["author"]["uid"].text) }
            .navigationTitle("核验发帖人").task(id: store.sessionRevision) { await state.load(store, path: "/api/admin/discussion/posts/\(NativeRoutes.component(postID))/author") }
    }
}
