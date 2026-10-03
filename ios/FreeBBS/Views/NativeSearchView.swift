import SwiftUI

struct NativeSearchView: View {
    @Environment(AppStore.self) private var store
    @Binding var query: String
    var onOpen: () -> Void = {}
    @State private var state = NativeWorkspace()
    @State private var type = "all"
    @State private var rows: [SiteRecord] = []
    @State private var offset = 0
    @State private var more = false
    @State private var searchVersion = 0
    var body: some View {
        List {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Section("探索 FREE-BBS") {
                    ForEach(FeatureCatalog.entries.filter { FeatureCatalog.visible($0, user: store.user) }.prefix(10)) { feature in
                        NavigationLink { FeatureWorkspaceView(destination: .init(feature)).onAppear(perform: onOpen) } label: { Label(feature.title, systemImage: feature.symbol) }
                    }
                }
            } else {
                Section { Picker("搜索范围", selection: $type) {
                    Text("全部").tag("all"); Text("页面").tag("page"); Text("讨论").tag("post"); Text("课程").tag("course"); Text("知识点").tag("knowledge"); Text("电路").tag("circuit")
                } }
                WorkspaceStatus(state: state)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, result in
                    if let url = AppConfiguration.safeLink(result["url"].text, origin: store.configuration.origin), let destination = FeatureDestination(url: url, origin: store.configuration.origin) {
                        NavigationLink { FeatureWorkspaceView(destination: destination).onAppear(perform: onOpen) } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(result["title"].text).font(.headline)
                                Text(result["description"].text.isEmpty ? result["excerpt"].text : result["description"].text).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                            }.padding(.vertical, 4)
                        }
                    }
                }
                if rows.isEmpty && !state.loading && state.error == nil { ContentUnavailableView.search(text: query) }
                if more { Button("加载更多") { Task { await search(append: true) } }.disabled(state.loading) }
            }
        }.navigationTitle("搜索").scrollDismissesKeyboard(.interactively)
        .task(id: "\(store.sessionRevision)-\(query)-\(type)") {
            do { try await Task.sleep(for: .milliseconds(300)); try Task.checkCancellation(); await search() } catch { }
        }
    }
    private func search(append: Bool = false) async {
        searchVersion += 1
        let requestVersion = searchVersion
        let requestQuery = query
        let requestType = type
        let session = store.sessionRevision
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { rows = []; more = false; return }
        if !append { rows = []; offset = 0; more = false }
        await state.load(store, path: "/api/search", query: [.init(name: "q", value: query), .init(name: "type", value: type), .init(name: "offset", value: String(offset))])
        guard !Task.isCancelled, requestVersion == searchVersion,
              query == requestQuery, type == requestType, session == store.sessionRevision else { return }
        if state.error == nil {
            rows += state.data["results"].list.filter { record in
                guard let url = URL(string: record["url"].text, relativeTo: store.configuration.origin) else { return false }
                return !FeatureCatalog.unavailableOnPhone(url)
            }
            offset = state.data["nextOffset"].int; more = state.data["hasMore"].flag
        }
    }
}
struct NativeSearchPage: View {
    @State private var query = ""
    var body: some View { NativeSearchView(query: $query).searchable(text: $query, prompt: "搜索 FREE-BBS") }
}

struct NativeCourseDestination: View {
    @Environment(AppStore.self) private var store
    let destination: FeatureDestination
    @State private var state = NativeWorkspace()
    @State private var course: Course?
    @State private var node: KnowledgeNode?
    var body: some View {
        Group {
            if state.loading { ProgressView("正在加载课程…") }
            else if state.error != nil { List { WorkspaceStatus(state: state); Button("重试") { Task { await load() } } } }
            else if let course {
                if let node { KnowledgeView(course: course, node: node) }
                else { CourseDetailView(course: course) }
            } else if state.loading { ProgressView("正在加载课程…") }
            else if state.error != nil { List { WorkspaceStatus(state: state); Button("重试") { Task { await load() } } } }
            else { CoursesView() }
        }.task(id: destination.path + String(store.sessionRevision)) { await load() }
    }
    private func load() async {
        course = nil; node = nil
        guard let slug = NativeRoutes.query(destination, "course") ?? (NativeRoutes.query(destination, "point") != nil ? "signals" : nil), !slug.isEmpty else { return }
        if let value = store.courses.first(where: { $0.slug == slug }) { course = value }
        else {
            await state.load(store, path: "/api/courses")
            course = (try? state.data["courses"].decoded([Course].self))?.first { $0.slug == slug }
        }
        if let point = NativeRoutes.query(destination, "point"), let course {
            await state.load(store, path: "/api/courses/\(NativeRoutes.component(course.slug))/map/nodes/\(NativeRoutes.component(point))")
            node = try? state.data["node"].decoded(KnowledgeNode.self)
        }
    }
}
