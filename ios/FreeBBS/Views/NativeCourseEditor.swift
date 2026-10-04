import SwiftUI
import PhotosUI

struct NativeDocumentEditor: View {
    @Environment(AppStore.self) private var store
    let destination: FeatureDestination
    @State private var state = NativeWorkspace()
    @State private var sections = ["knowledgeMarkdown": "", "basicInfoMarkdown": "", "applicationsMarkdown": ""]
    @State private var section = "knowledgeMarkdown"
    @State private var preview = false
    @State private var photo: PhotosPickerItem?
    private var base: String { "/api/courses/\(NativeRoutes.component(NativeRoutes.query(destination, "course") ?? "signals"))/map" }
    private var path: String { base + "/nodes/" + NativeRoutes.component(NativeRoutes.query(destination, "point") ?? "") }
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            Section {
                Picker("分区", selection: $section) { Text("知识").tag("knowledgeMarkdown"); Text("基本信息").tag("basicInfoMarkdown"); Text("应用").tag("applicationsMarkdown") }
                if preview { MarkdownContent(source: sections[section] ?? "") }
                else { TextEditor(text: Binding(get: { sections[section] ?? "" }, set: { sections[section] = $0 })).font(.system(.body, design: .monospaced)).frame(minHeight: 340).accessibilityIdentifier("nativeDocumentEditor") }
            }
            Section {
                PhotosPicker("插入图片", selection: $photo, matching: .images).disabled(!state.data["course"]["canEditMap"].flag || state.busy)
                if !state.data["course"]["canEditMap"].flag && !state.loading { Text("保存需要该课程的资料负责人权限。").foregroundStyle(.secondary) }
            }
        }.navigationTitle(state.data["node"]["title"].text.isEmpty ? "Markdown 编辑器" : state.data["node"]["title"].text)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button(preview ? "编辑" : "预览") { preview.toggle() } }
            ToolbarItem(placement: .confirmationAction) { Button("保存") { Task { await save() } }.disabled(state.busy || state.loading || !state.data["course"]["canEditMap"].flag) }
        }
        .task(id: store.sessionRevision) {
            sections = ["knowledgeMarkdown": "", "basicInfoMarkdown": "", "applicationsMarkdown": ""]
            await state.load(store, path: path)
            for key in sections.keys { sections[key] = state.data["node"]["sections"][key].text }
            if sections["knowledgeMarkdown"]?.isEmpty == true { sections["knowledgeMarkdown"] = state.data["node"]["markdown"].text }
        }
        .onChange(of: photo) { _, item in Task {
            let target = section; let session = store.sessionRevision
            do {
                guard let data = try await item?.loadTransferable(type: Data.self), data.count <= 5 * 1024 * 1024, let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.8) else { state.error = "请选择不超过 5 MiB 的图片。"; return }
                guard session == store.sessionRevision else { return }
                if let result = await state.mutate(store, path: base + "/uploads/images", body: ["imageDataUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString()]), !result["url"].text.isEmpty { sections[target, default: ""] += "\n![图片](" + result["url"].text + ")\n" }
            } catch { state.error = error.localizedDescription }
        } }
    }
    private func save() async {
        if let result = await state.mutate(store, path: path + "/document", method: "PUT", body: ["sections": sections, "expectedRevision": state.data["node"]["revision"].text]) {
            var fields = state.data.fields; fields["node"] = result["node"]; state.data = .object(fields); state.notice = "文档已保存。"
        }
    }
}

struct NativeCourseMapEditor: View {
    @Environment(AppStore.self) private var store
    let destination: FeatureDestination
    @State private var state = NativeWorkspace()
    @State private var node: CourseNodeEdit?
    @State private var source = ""
    @State private var target = ""
    @State private var relation = "ordered"
    @State private var photo: PhotosPickerItem?
    @State private var deletion: CourseEdgeDelete?
    private var slug: String { NativeRoutes.query(destination, "course") ?? "signals" }
    private var base: String { "/api/courses/\(NativeRoutes.component(slug))/map" }
    private var editable: Bool { state.data["course"]["canEditMap"].flag }
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            if !editable && !state.loading { Text("编辑需要该课程的资料负责人权限。").foregroundStyle(.secondary) }
            Section("知识点") {
                ForEach(Array(state.data["nodes"].list.enumerated()), id: \.offset) { _, record in
                    Button { node = .init(record: record) } label: {
                        VStack(alignment: .leading, spacing: 5) { Text(record["title"].text).font(.headline); Text(record["id"].text + " · " + record["summary"].text).font(.caption).foregroundStyle(.secondary) }
                    }.disabled(!editable)
                }
                Button("添加知识点", systemImage: "plus") { node = .init(record: .empty) }.disabled(!editable)
            }
            Section("连接") {
                ForEach(Array(state.data["edges"].list.enumerated()), id: \.offset) { _, edge in
                    HStack { Text(edge["source"].text + (edge["type"].text == "ordered" ? " → " : " ↔ ") + edge["target"].text); Spacer(); if editable { Button("删除", role: .destructive) { deletion = .init(record: edge) } } }
                }
                Picker("起点", selection: $source) { Text("请选择").tag(""); ForEach(state.data["nodes"].list.map { $0["id"].text }, id: \.self) { Text($0).tag($0) } }
                Picker("终点", selection: $target) { Text("请选择").tag(""); ForEach(state.data["nodes"].list.map { $0["id"].text }, id: \.self) { Text($0).tag($0) } }
                Picker("关系", selection: $relation) { Text("顺序").tag("ordered"); Text("关联").tag("related") }
                Button("添加连接") { Task { if await state.mutate(store, path: base + "/edges", body: ["source": source, "target": target, "type": relation]) != nil { await load() } } }.disabled(!editable || source.isEmpty || target.isEmpty || source == target || state.busy)
            }
            Section("地图背景") {
                PhotosPicker("上传背景图片", selection: $photo, matching: .images).disabled(!editable || state.busy)
                Button("清除背景", role: .destructive) { Task { if await state.mutate(store, path: base + "/background", method: "PUT", body: ["backgroundUrl": ""]) != nil { await load() } } }.disabled(!editable || state.busy)
            }
        }.navigationTitle("编辑课程地图").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { await load() }
        .sheet(item: $node) { record in NavigationStack { NativeCourseNodeEditor(slug: slug, record: record.record) { Task { await load() } }.environment(store) } }
        .confirmationDialog("删除此连接？", isPresented: Binding(get: { deletion != nil }, set: { if !$0 { deletion = nil } }), titleVisibility: .visible) {
            if let deletion { Button("删除", role: .destructive) { self.deletion = nil; Task { if await state.mutate(store, path: base + "/edges", method: "DELETE", body: deletion.record.fields.mapValues(\.value)) != nil { await load() } } } }
        }
        .onChange(of: photo) { _, item in Task {
            let session = store.sessionRevision
            do {
                guard let data = try await item?.loadTransferable(type: Data.self), data.count <= 8 * 1024 * 1024, let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.8) else { state.error = "图片大小或格式不受支持。"; return }
                guard session == store.sessionRevision else { return }
                if await state.mutate(store, path: base + "/background", method: "PUT", body: ["imageDataUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString()]) != nil { await load() }
            } catch { state.error = error.localizedDescription }
        } }
    }
    private func load() async { await state.load(store, path: base) }
}
struct CourseNodeEdit: Identifiable { let id = UUID(); let record: SiteRecord }
struct CourseEdgeDelete: Identifiable { let id = UUID(); let record: SiteRecord }
struct NativeCourseNodeEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let slug: String; let record: SiteRecord; let saved: () -> Void
    @State private var state = NativeWorkspace()
    @State private var id = ""
    @State private var title = ""
    @State private var summary = ""
    @State private var x = 0.0
    @State private var y = 0.0
    @State private var deletion = false
    private var existing: Bool { !record["id"].text.isEmpty }
    private var base: String { "/api/courses/\(NativeRoutes.component(slug))/map/nodes" }
    var body: some View {
        Form {
            Section {
                TextField("知识点 ID（如 SS-01-01）", text: $id).textInputAutocapitalization(.characters).autocorrectionDisabled().disabled(existing)
                TextField("标题", text: $title)
                TextField("简介", text: $summary, axis: .vertical).lineLimit(3...6)
                TextField("横坐标", value: $x, format: .number).keyboardType(.numbersAndPunctuation)
                TextField("纵坐标", value: $y, format: .number).keyboardType(.numbersAndPunctuation)
            }
            WorkspaceStatus(state: state)
            if existing {
                NavigationLink("编辑文档") { NativeDocumentEditor(destination: .init(path: "/markdown-editor?course=\(slug)&point=\(id)", title: title)) }
                Button("删除知识点", role: .destructive) { deletion = true }
            }
        }.navigationTitle(existing ? "编辑知识点" : "添加知识点").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("保存") { Task {
                if await state.mutate(store, path: existing ? base + "/" + NativeRoutes.component(id) : base, method: existing ? "PATCH" : "POST", body: ["id": id, "title": title, "summary": summary, "position": ["x": x, "y": y]]) != nil { saved(); dismiss() }
            } }.disabled(id.isEmpty || title.isEmpty || title.count > 160 || summary.count > 500 || state.busy) }
        }
        .onAppear { id = record["id"].text; title = record["title"].text; summary = record["summary"].text; x = Double(record["position"]["x"].text) ?? 0; y = Double(record["position"]["y"].text) ?? 0 }
        .confirmationDialog("删除知识点及其连接？", isPresented: $deletion, titleVisibility: .visible) { Button("删除", role: .destructive) { Task { if await state.mutate(store, path: base + "/" + NativeRoutes.component(id), method: "DELETE") != nil { saved(); dismiss() } } } }
    }
}
