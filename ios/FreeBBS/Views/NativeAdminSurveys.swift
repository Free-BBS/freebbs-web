import SwiftUI

struct NativeAdminSurveys: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var editor: AdminSurveySelection?
    @State private var rows: [SiteRecord] = []
    @State private var next: Int? = 0
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, survey in
                NavigationLink { NativeAdminSurveyDetail(survey: survey) { Task { await load() } } } label: {
                    VStack(alignment: .leading, spacing: 5) { Text(survey["title"].text).font(.headline); Text(survey["status"].text + " · " + survey["entryCount"].text + " 人报名").font(.subheadline).foregroundStyle(.secondary) }
                }
            }
            if next != nil && !rows.isEmpty { Button("加载更多") { Task { await load(more: true) } }.disabled(state.loading) }
        }.navigationTitle("报名活动管理").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("创建活动", systemImage: "plus") { editor = .init(record: .empty) } } }
        .task(id: store.sessionRevision) { await load() }.refreshable { await load() }
        .sheet(item: $editor) { selected in NavigationStack { NativeAdminSurveyEditor(record: selected.record) { Task { await load() } }.environment(store) } }
    }
    private func load(more: Bool = false) async {
        if !more { rows = []; next = 0 }; guard let page = next else { return }
        await state.load(store, path: "/api/admin/surveys", query: [.init(name: "page", value: String(page))])
        if state.error == nil { rows += state.data["surveys"].list; next = state.data["nextPage"] == .null ? nil : state.data["nextPage"].int }
    }
}
struct AdminSurveySelection: Identifiable { let id = UUID(); let record: SiteRecord }
struct NativeAdminSurveyDetail: View {
    @Environment(AppStore.self) private var store
    @State var survey: SiteRecord; let changed: () -> Void
    @State private var state = NativeWorkspace()
    @State private var editor = false
    @State private var copying = false
    @State private var confirmation: String?
    @State private var export: LabExport?
    private var base: String { "/api/admin/surveys/" + NativeRoutes.component(survey["id"].text) }
    var body: some View {
        List {
            Section { Text(survey["title"].text).font(.headline); Text(survey["description"].text); LabeledContent("状态", value: survey["status"].text); LabeledContent("名额", value: survey["winnerCount"].text) }
            WorkspaceStatus(state: state)
            Section("管理") {
                if survey["status"].text == "draft" { Button("编辑草稿") { copying = false; editor = true }; Button("发布") { confirmation = "publish" } }
                Button("复制为新一期") { copying = true; editor = true }
                if survey["status"].text == "published" { Button("抽签") { confirmation = "draw" }; Button("取消活动", role: .destructive) { confirmation = "cancel" } }
                if survey["repeatDays"].int > 0 { Button("停止自动重复") { confirmation = "stop-repeat" } }
                Button("读取报名资料") { Task { await state.load(store, path: base + "/entries") } }
                if !state.data["entries"].list.isEmpty { Button("导出报名 CSV", systemImage: "square.and.arrow.up") { writeCSV() } }
            }
            Section("报名资料（仅管理员可见）") {
                ForEach(Array(state.data["entries"].list.enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry["contact"].text).font(.headline)
                        ForEach(entry["answers"].fields.keys.sorted(), id: \.self) { key in Text(key + "：" + (entry["answers"][key].list.isEmpty ? entry["answers"][key].text : entry["answers"][key].list.map(\.text).joined(separator: "、"))).font(.subheadline) }
                        Text(entry["winner"].flag ? "中签" : "未中签或待抽签").font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 5)
                }
            }
        }.navigationTitle("活动管理").navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("确认执行此活动操作？", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }), titleVisibility: .visible) {
            if let confirmation { Button("确认") { self.confirmation = nil; Task { if let result = await state.mutate(store, path: base + "/" + confirmation) { if result["survey"] != .null { survey = result["survey"] }; state.notice = "操作已完成。"; changed() } } } }
        }
        .sheet(isPresented: $editor) { NavigationStack { NativeAdminSurveyEditor(record: survey, copy: copying) { changed() }.environment(store) } }
        .sheet(item: $export) { item in LabShareSheet(url: item.url).onDisappear { SiteImports.discard([item.url]) } }
        .onChange(of: store.sessionRevision) { _, _ in state.data = .empty; export = nil; editor = false }
    }
    private func writeCSV() {
        func cell(_ value: String) -> String { "\"" + (value.hasPrefix("=") || value.hasPrefix("+") || value.hasPrefix("-") || value.hasPrefix("@") ? "'" : "") + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        let columns = survey["questions"].list.map { $0["id"].text }
        var lines = [(["联系邮箱", "中签", "报名时间"] + columns).map(cell).joined(separator: ",")]
        for entry in state.data["entries"].list {
            let values = [entry["contact"].text, entry["winner"].flag ? "是" : "否", entry["created_at"].text] + columns.map { entry["answers"][$0].list.isEmpty ? entry["answers"][$0].text : entry["answers"][$0].list.map(\.text).joined(separator: "、") }
            lines.append(values.map(cell).joined(separator: ","))
        }
        do { let url = try SiteImports.directory().appendingPathComponent("freebbs-survey.csv"); try Data(("\u{FEFF}" + lines.joined(separator: "\r\n")).utf8).write(to: url, options: .atomic); export = .init(url: url) }
        catch { state.error = error.localizedDescription }
    }
}
struct AdminSurveyQuestion: Identifiable {
    let id = UUID(); var label = ""; var type = "text"; var required = true; var options = ""
}
struct NativeAdminSurveyEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let record: SiteRecord; var copy = false; let saved: () -> Void
    @State private var state = NativeWorkspace()
    @State private var title = ""
    @State private var description = ""
    @State private var opens = Date.now
    @State private var closes = Date.now.addingTimeInterval(86400)
    @State private var winners = 1
    @State private var days = 0
    @State private var mode = "manual"
    @State private var login = false
    @State private var questions: [AdminSurveyQuestion] = [.init()]
    private var existing: Bool { !record["id"].text.isEmpty && !copy }
    var body: some View {
        Form {
            Section("活动") {
                TextField("标题", text: $title)
                TextField("说明", text: $description, axis: .vertical).lineLimit(3...10)
                DatePicker("开放", selection: $opens)
                DatePicker("截止", selection: $closes)
                Stepper("抽签名额 \(winners)", value: $winners, in: 1...10000)
                Picker("抽签方式", selection: $mode) { Text("管理员抽签").tag("manual"); Text("自动抽签").tag("auto") }
                Stepper(days == 0 ? "不重复" : "每 \(days) 天重复", value: $days, in: 0...365)
                Toggle("登录后报名", isOn: $login)
            }
            ForEach($questions) { $question in
                Section("题目") {
                    TextField("题目标题", text: $question.label)
                    Picker("题型", selection: $question.type) { Text("短文本").tag("text"); Text("长文本").tag("textarea"); Text("单选").tag("single"); Text("多选").tag("multiple") }
                    Toggle("必填", isOn: $question.required)
                    if question.type == "single" || question.type == "multiple" { TextField("每行一个选项", text: $question.options, axis: .vertical).lineLimit(3...10) }
                    Button("移除此题", role: .destructive) { questions.removeAll { $0.id == question.id } }.disabled(questions.count <= 1)
                }
            }
            Button("添加题目", systemImage: "plus") { questions.append(.init()) }.disabled(questions.count >= 50)
            WorkspaceStatus(state: state)
        }.navigationTitle(existing ? "编辑活动" : "创建活动").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("保存草稿") { Task { await save() } }.disabled(state.busy || title.isEmpty || title.count > 160 || description.count > 5000 || closes <= opens || questions.contains { $0.label.isEmpty }) }
        }
        .onAppear {
            title = record["title"].text; description = record["description"].text
            if !record["id"].text.isEmpty {
                if !copy { opens = AppDates.parse(record["opensAt"].text) ?? .now; closes = AppDates.parse(record["closesAt"].text) ?? .now.addingTimeInterval(86400) }
                winners = max(1, record["winnerCount"].int); days = record["repeatDays"].int; mode = record["drawMode"].text; login = record["requiresLogin"].flag
                questions = record["questions"].list.map { .init(label: $0["label"].text, type: $0["type"].text, required: $0["required"].flag, options: $0["options"].list.map(\.text).joined(separator: "\n")) }
            }
        }
    }
    private func save() async {
        let format = ISO8601DateFormatter()
        let list: [[String: Any]] = questions.map { ["label": $0.label, "type": $0.type, "required": $0.required, "options": $0.options.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }] }
        let body: [String: Any] = ["title": title, "description": description, "opensAt": format.string(from: opens), "closesAt": format.string(from: closes), "winnerCount": winners, "repeatDays": days, "drawMode": mode, "requiresLogin": login, "questions": list]
        if await state.mutate(store, path: "/api/admin/surveys" + (existing ? "/" + NativeRoutes.component(record["id"].text) : ""), method: existing ? "PUT" : "POST", body: body) != nil { saved(); dismiss() }
    }
}
