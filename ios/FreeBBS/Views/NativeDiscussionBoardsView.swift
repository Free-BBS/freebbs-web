import SwiftUI

struct NativeDiscussionBoardsView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            ForEach(Array(state.data["boards"].list.enumerated()), id: \.offset) { _, board in
                NavigationLink { NativeBoardEditor(board: board) } label: {
                    VStack(alignment: .leading, spacing: 5) { Text(board["name"].text).font(.headline); Text(board["description"].text).foregroundStyle(.secondary) }.padding(.vertical, 5)
                }
            }
        }.navigationTitle("讨论版块").task(id: store.sessionRevision) { await state.load(store, path: "/api/discussion/boards") }
    }
}
struct NativeBoardEditor: View {
    @Environment(AppStore.self) private var store
    let board: SiteRecord
    @State private var state = NativeWorkspace()
    @State private var moderators = NativeWorkspace()
    @State private var candidates = NativeWorkspace()
    @State private var description = ""
    @State private var query = ""
    private var base: String { "/api/discussion/boards/" + NativeRoutes.component(board["slug"].text) }
    var body: some View {
        Form {
            Section("版块说明") {
                if board["canModerate"].flag {
                    TextEditor(text: $description).frame(minHeight: 200)
                    Button("保存说明") { Task { if await state.mutate(store, path: base + "/description", method: "PATCH", body: ["descriptionMarkdown": description]) != nil { state.notice = "说明已保存。" } } }.disabled(description.isEmpty || description.count > 10000 || state.busy)
                } else { MarkdownContent(source: description) }
            }
            WorkspaceStatus(state: state)
            if board["canManageModerators"].flag {
                Section("版主") {
                    WorkspaceStatus(state: moderators)
                    ForEach(Array(moderators.data["moderators"].list.enumerated()), id: \.offset) { _, person in
                        HStack { Text(person["username"].text); Spacer(); Button("移除", role: .destructive) { Task { await assign(person, value: false) } } }
                    }
                    TextField("搜索用户", text: $query)
                    Button("搜索") { Task { await candidates.load(store, path: base + "/moderator-candidates", query: [.init(name: "query", value: query)]) } }
                    WorkspaceStatus(state: candidates)
                    ForEach(Array(candidates.data["users"].list.enumerated()), id: \.offset) { _, person in
                        Button("任命 " + person["username"].text) { Task { await assign(person, value: true) } }
                    }
                }
            }
        }.navigationTitle(board["name"].text).navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) {
            description = board["descriptionMarkdown"].text.isEmpty ? board["description"].text : board["descriptionMarkdown"].text
            if board["canManageModerators"].flag { await moderators.load(store, path: base + "/moderators") }
        }
    }
    private func assign(_ person: SiteRecord, value: Bool) async {
        if await state.mutate(store, path: base + "/moderators/" + NativeRoutes.component(person["id"].text), method: "PATCH", body: ["isModerator": value]) != nil { await moderators.load(store, path: base + "/moderators") }
    }
}
