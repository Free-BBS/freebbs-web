import SwiftUI

struct MarkdownDocumentPicker: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        List {
            Section {
                Text("先选择课程和知识点，再进入文档编辑。").foregroundStyle(.secondary)
            }
            Section {
                ForEach(store.courses) { course in
                    NavigationLink { MarkdownNodePicker(course: course) } label: {
                        HStack(spacing: 14) {
                            Image(systemName: course.symbol).font(.title2).foregroundStyle(Palette.teal)
                                .frame(width: 36).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(course.name).font(.headline)
                                Text(course.summary.isEmpty ? course.description : course.summary)
                                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }.padding(.vertical, 5)
                    }
                        .accessibilityIdentifier("document-course-" + course.slug)
                }
                if store.courses.isEmpty {
                    if store.loading { ProgressView("正在加载课程…") }
                    else { Button("加载课程") { Task { await store.bootstrap() } } }
                }
            } header: { Text("课程") } footer: { Text("文档保存和图片上传沿用课程组的编辑权限。") }
        }.listStyle(.insetGrouped)
            .task { if store.courses.isEmpty { await store.bootstrap() } }
    }
}

private struct MarkdownNodePicker: View {
    @Environment(AppStore.self) private var store
    let course: Course
    @State private var nodes: [KnowledgeNode] = []
    @State private var loading = false
    @State private var error: String?
    @State private var search = ""
    var body: some View {
        List {
            if store.isDemo { ContentUnavailableView("文档选择预览", systemImage: "text.document", description: Text("正式版本会读取课程知识点；预览模式不会编辑线上资料。")) }
            else {
                if loading { ProgressView("正在加载知识点…") }
                if let error { Text(error).foregroundStyle(.secondary); Button("重试") { Task { await load() } } }
                ForEach(nodes.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { node in
                    NavigationLink {
                        FeatureWorkspaceView(destination: .init(path: editorURL(node).absoluteString, title: node.title))
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(node.title).font(.headline)
                            if !node.summary.isEmpty { Text(node.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
                        }.padding(.vertical, 5)
                    }
                }
                if nodes.isEmpty && !loading && error == nil { ContentUnavailableView("暂无知识点", systemImage: "text.document") }
            }
        }.listStyle(.insetGrouped).navigationTitle(course.name).navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "查找知识点")
            .task { await load() }.refreshable { await load() }
    }
    private func load() async {
        guard !store.isDemo else { return }
        loading = true; error = nil; defer { loading = false }
        do { let map: CourseMap = try await store.api.request("/api/courses/" + course.slug + "/map"); nodes = map.nodes }
        catch { self.error = error.localizedDescription }
    }
    private func editorURL(_ node: KnowledgeNode) -> URL {
        var url = URLComponents(url: store.configuration.origin, resolvingAgainstBaseURL: false)!
        url.path = "/markdown-editor"; url.queryItems = [.init(name: "course", value: course.slug), .init(name: "point", value: node.id)]
        return url.url!
    }
}
