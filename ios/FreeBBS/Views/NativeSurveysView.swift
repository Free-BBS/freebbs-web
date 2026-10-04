import SwiftUI
import Security

struct NativeSurveysView: View {
    @Environment(AppStore.self) private var store
    var surveyID: String? = nil
    @State private var state = NativeWorkspace()
    @State private var rows: [SiteRecord] = []
    @State private var nextPage: Int? = 0
    var body: some View {
        Group {
            if let surveyID { NativeSurveyForm(id: surveyID) }
            else { List {
                WorkspaceStatus(state: state)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, survey in
                    NavigationLink { NativeSurveyForm(id: survey["id"].text) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(survey["title"].text).font(.headline)
                            Text(survey["description"].text).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                            Text("\(survey["winnerCount"].int) 个名额 · 截止 \(AppDates.short(survey["closesAt"].text))").font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 5)
                    }
                }
                if rows.isEmpty && !state.loading && state.error == nil { ContentUnavailableView("新的活动正在筹备中", systemImage: "ticket") }
                if nextPage != nil && !rows.isEmpty { Button("加载更多活动") { Task { await load(more: true) } }.disabled(state.loading) }
            }.refreshable { await load() } }
        }.navigationTitle("活动报名（试用）").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { if surveyID == nil { await load() } }
    }
    private func load(more: Bool = false) async {
        if !more { rows = []; nextPage = 0 }
        guard let page = nextPage else { return }
        await state.load(store, path: "/api/surveys", query: [.init(name: "page", value: String(page))])
        if state.error == nil { rows += state.data["surveys"].list; nextPage = state.data["nextPage"] == .null ? nil : state.data["nextPage"].int }
    }
}
struct NativeSurveyForm: View {
    @Environment(AppStore.self) private var store
    let id: String
    @State private var state = NativeWorkspace()
    @State private var contact = ""
    @State private var answers: [String: String] = [:]
    @State private var choices: [String: Set<String>] = [:]
    @State private var receipt = ""
    @State private var submissionReceipt = ""
    @State private var submitted = false
    @State private var result = ""
    @State private var confirmed = false
    private var survey: SiteRecord { state.data["survey"] }
    private var open: Bool { survey["status"].text == "published" && (AppDates.parse(survey["opensAt"].text) ?? .distantFuture) <= .now && (AppDates.parse(survey["closesAt"].text) ?? .distantPast) > .now }
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            if !survey["title"].text.isEmpty {
                Section {
                    Text(survey["title"].text).font(.title2.bold())
                    Text(survey["description"].text)
                    LabeledContent("截止", value: AppDates.short(survey["closesAt"].text))
                    LabeledContent("名额", value: survey["winnerCount"].text)
                }
                if submitted {
                    Section("报名成功") {
                        Text("请保存回执，用它查询结果；联系邮箱与回答仅管理员可见。").foregroundStyle(.secondary)
                        Text(receipt).font(.caption.monospaced()).textSelection(.enabled)
                        ShareLink(item: "FREE-BBS 报名回执\n活动编号：\(id)\n回执：\(receipt)") { Label("保存或分享回执", systemImage: "square.and.arrow.up") }
                    }
                } else if open {
                    if survey["requiresLogin"].flag && store.user == nil { NativeAccountRequired(title: "登录后报名") }
                    else {
                        Section("联系信息") { TextField("联系邮箱", text: $contact).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled() }
                        ForEach(Array(survey["questions"].list.enumerated()), id: \.offset) { _, question in
                            Section(question["label"].text + (question["required"].flag ? " *" : "（选填）")) {
                                if question["type"].text == "single" {
                                    Picker("选择", selection: Binding(get: { answers[question["id"].text] ?? "" }, set: { answers[question["id"].text] = $0 })) {
                                        Text("未选择").tag("")
                                        ForEach(question["options"].list.map(\.text), id: \.self) { Text($0).tag($0) }
                                    }
                                } else if question["type"].text == "multiple" {
                                    ForEach(question["options"].list.map(\.text), id: \.self) { option in
                                        Toggle(option, isOn: Binding(get: { choices[question["id"].text]?.contains(option) ?? false }, set: { selected in
                                            var values = choices[question["id"].text] ?? []; if selected { values.insert(option) } else { values.remove(option) }; choices[question["id"].text] = values
                                        }))
                                    }
                                } else { TextField("回答", text: Binding(get: { answers[question["id"].text] ?? "" }, set: { answers[question["id"].text] = $0 }), axis: .vertical).lineLimit(3...10) }
                            }
                        }
                        Section {
                            Toggle("确认报名资料用于本次活动组织", isOn: $confirmed)
                            Button("提交报名") { Task { await submit() } }.disabled(!confirmed || contact.isEmpty || state.busy)
                        }
                    }
                } else { Text("当前不在报名时间内。").foregroundStyle(.secondary) }
                Section("查询抽签结果") {
                    TextField("报名回执", text: $receipt, axis: .vertical).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("查询结果") { Task {
                        if let data = await state.perform(store, path: "/api/surveys/\(NativeRoutes.component(id))/result", body: ["receipt": receipt]) {
                            result = ["won": "已中签，请留意后续联系。", "lost": "本期未中签。", "pending": "报名已收到，尚未抽签。", "cancelled": "本期活动已取消。"][data["result"].text] ?? ""
                        }
                    } }.disabled(receipt.count != 64 || state.busy)
                    if !result.isEmpty { Text(result).font(.headline) }
                }
            }
        }.navigationTitle("活动详情").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) {
            contact = ""; answers = [:]; choices = [:]; receipt = ""; submissionReceipt = ""; submitted = false; result = ""; confirmed = false
            await state.load(store, path: "/api/surveys/" + NativeRoutes.component(id))
        }
    }
    private func submit() async {
        var payload: [String: Any] = [:]
        for q in survey["questions"].list {
            let key = q["id"].text
            if q["type"].text == "multiple" { let selected = choices[key] ?? []; if q["required"].flag && selected.isEmpty { state.error = q["label"].text + "为必填项。"; return }; payload[key] = selected.sorted() }
            else { let answer = answers[key] ?? ""; if q["required"].flag && answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { state.error = q["label"].text + "为必填项。"; return }; payload[key] = answer }
        }
        if submissionReceipt.isEmpty {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { state.error = "无法生成报名回执，请重试。"; return }
            submissionReceipt = bytes.map { String(format: "%02x", $0) }.joined()
        }
        if let data = await state.perform(store, path: "/api/surveys/\(NativeRoutes.component(id))/entries", body: ["contact": contact, "answers": payload, "receipt": submissionReceipt]) { receipt = data["receipt"].text; submitted = true }
    }
}
