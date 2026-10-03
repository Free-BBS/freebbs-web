import SwiftUI

struct CourseRow: View {
    let course: Course
    var body: some View {
        Paper {
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: course.symbol).font(.title2).foregroundStyle(Palette.teal)
                    .frame(width: 50, height: 50).background(Palette.teal.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 7) {
                    Text(course.name).font(.headline).foregroundStyle(.primary)
                    Text(course.summary.isEmpty ? course.description : course.summary)
                        .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary).padding(.top, 18)
            }
        }.accessibilityElement(children: .combine)
    }
}
struct CoursesView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    private var filtered: [Course] {
        store.courses.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.summary.localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        List {
            ForEach(filtered) { course in
                NavigationLink { CourseDetailView(course: course) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: course.symbol).font(.title2).foregroundStyle(Palette.teal).frame(width: 36)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(course.name).font(.headline)
                            Text(course.summary.isEmpty ? course.description : course.summary)
                                .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }.padding(.vertical, 8)
                }
            }
            if filtered.isEmpty { EmptyState(title: search.isEmpty ? "暂无课程" : "没有找到课程", symbol: "books.vertical", message: "试试其他关键词，或下拉刷新。") }
        }.listStyle(.insetGrouped).navigationTitle("课程").searchable(text: $search, prompt: "搜索课程")
            .refreshable { await store.bootstrap() }
    }
}

struct CourseDetailView: View {
    @Environment(AppStore.self) private var store
    let course: Course
    @State private var map: CourseMap?
    @State private var search = ""
    @State private var showMap = false
    @State private var loading = false
    private var nodes: [KnowledgeNode] {
        (map?.nodes ?? []).filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }
            .sorted { $0.position.y == $1.position.y ? $0.position.x < $1.position.x : $0.position.y < $1.position.y }
    }
    var body: some View {
        PageSurface {
            Paper {
                Image(systemName: course.symbol).font(.largeTitle).foregroundStyle(Palette.teal).accessibilityHidden(true)
                Text(course.description).foregroundStyle(.secondary)
                if let map { Text("\(map.nodes.count) 个知识点 · \(map.edges.count) 条连接").font(.caption).foregroundStyle(.secondary) }
            }
            Picker("浏览方式", selection: $showMap) { Text("知识点").tag(false); Text("关系图").tag(true) }.pickerStyle(.segmented)
            NavigationLink { CourseFilesView(course: course) } label: { Label("课程资料", systemImage: "doc.on.doc").frame(minHeight: 44) }
            if loading { ProgressView("正在加载知识点…") }
            else if showMap, let map { KnowledgeMapView(map: map, course: course) }
            else {
                ForEach(nodes) { node in
                    NavigationLink { KnowledgeView(course: course, node: node) } label: {
                        Paper {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(node.title).font(.headline).foregroundStyle(.primary)
                                    if !node.summary.isEmpty { Text(node.summary).font(.subheadline).foregroundStyle(.secondary) }
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "arrow.up.right").foregroundStyle(Palette.teal)
                            }
                        }
                    }.buttonStyle(.plain)
                }
                if nodes.isEmpty { EmptyState(title: "暂无知识点", symbol: "point.3.connected.trianglepath.dotted", message: "课程资料更新后，会显示在这里。") }
            }
        }.navigationTitle(course.name).navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "查找知识点")
            .task { await load() }.refreshable { await load() }
    }
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            if store.isDemo {
                let nodes = [KnowledgeNode(id: "convolution", title: "卷积", summary: "把重叠的变化，变成系统的响应。", position: .init(x: 0, y: 0), hasDocument: true, markdown: "## 卷积的直觉\n\n翻转、平移、相乘，再把所有贡献加起来。\n\n**卷积连接了输入、系统和输出。**", sections: .init(knowledgeMarkdown: "## 卷积的直觉\n\n翻转、平移、相乘，再把所有贡献加起来。", basicInfoMarkdown: "适用于线性时不变系统。", applicationsMarkdown: "图像滤波、音频处理与通信系统。")), KnowledgeNode(id: "fourier", title: "傅里叶变换", summary: "换一个角度，看见频率。", position: .init(x: 1, y: 1), hasDocument: true, markdown: "用不同频率的复指数表示信号。", sections: nil)]
                map = CourseMap(course: course, nodes: nodes, edges: [.init(source: "convolution", target: "fourier", type: "ordered")])
            } else { map = try await store.api.request("/api/courses/\(course.slug)/map") }
        } catch { store.error = error.localizedDescription }
    }
}

struct KnowledgeMapView: View {
    let map: CourseMap
    let course: Course
    var body: some View {
        // The phone graph uses readable adjacency rows rather than tiny desktop coordinates.
        VStack(alignment: .leading, spacing: 16) {
            Text("点击任一知识点阅读；箭头表示学习顺序。").font(.subheadline).foregroundStyle(.secondary)
            ForEach(map.nodes) { node in
                Paper {
                    NavigationLink { KnowledgeView(course: course, node: node) } label: { Label(node.title, systemImage: "circle.fill").font(.headline) }
                        .frame(minHeight: 44)
                    let related = map.edges.filter { $0.source == node.id || ($0.type == "related" && $0.target == node.id) }
                    ForEach(Array(related.enumerated()), id: \.offset) { _, edge in
                        let targetID = edge.source == node.id ? edge.target : edge.source
                        if let target = map.nodes.first(where: { $0.id == targetID }) {
                            NavigationLink { KnowledgeView(course: course, node: target) } label: {
                                Label(target.title, systemImage: edge.type == "ordered" ? "arrow.down.right" : "link")
                                    .font(.subheadline)
                            }.frame(minHeight: 44).padding(.leading, 16)
                        }
                    }
                }
            }
        }
    }
}

struct KnowledgeView: View {
    @Environment(AppStore.self) private var store
    let course: Course
    let node: KnowledgeNode
    @State private var detail: KnowledgeNode?
    @State private var section = 0
    @State private var loading = false
    var body: some View {
        PageSurface {
            Text(node.title).font(.title.bold()).fixedSize(horizontal: false, vertical: true)
            Text(node.summary).foregroundStyle(.secondary)
            Picker("文档分区", selection: $section) {
                Text("知识").tag(0); Text("基本信息").tag(1); Text("应用").tag(2)
            }.pickerStyle(.segmented)
            if loading { ProgressView("正在加载正文…") }
            else {
                if content.isEmpty { Text("此分区暂无内容。").foregroundStyle(.secondary) }
                else { MarkdownContent(source: content) }
            }
            NavigationLink { ChatView(context: "课程：\(course.name)；知识点：\(node.title)\n\(content.prefix(12000))") } label: {
                Label("请 Max 帮我理解", systemImage: "sparkles").frame(minHeight: 48).frame(maxWidth: .infinity)
            }.buttonStyle(.bordered)
        }.navigationTitle("知识点").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { ShareLink(item: shareURL) } }
            .task { await load() }
    }
    private var shareURL: URL {
        var components = URLComponents(url: store.configuration.origin, resolvingAgainstBaseURL: false)!
        components.path = "/knowledge"
        components.queryItems = [.init(name: "course", value: course.slug), .init(name: "point", value: node.id)]
        return components.url!
    }
    private var content: String {
        let current = detail ?? node
        switch section {
        case 1: return current.sections?.basicInfoMarkdown ?? ""
        case 2: return current.sections?.applicationsMarkdown ?? ""
        default: return current.sections?.knowledgeMarkdown ?? current.markdown ?? ""
        }
    }
    private func load() async {
        guard !store.isDemo else { detail = node; return }
        loading = true
        defer { loading = false }
        do {
            let response: NodeResponse = try await store.api.request("/api/courses/\(course.slug)/map/nodes/\(node.id)")
            detail = response.node
        } catch { store.error = error.localizedDescription }
    }
}
