import SwiftUI

struct NativeAdminPublication: View {
    @Environment(AppStore.self) private var store
    var rewards = false
    @State private var state = NativeWorkspace()
    @State private var audience = NativeWorkspace()
    @State private var history = NativeWorkspace()
    @State private var title = ""
    @State private var bodyText = ""
    @State private var link = ""
    @State private var search = ""
    @State private var type = "all"
    @State private var role = "student"
    @State private var course = ""
    @State private var selected: Set<String> = []
    @State private var electric = 0
    @State private var magnetic = 0
    @State private var confirmation = false
    @State private var pending: [String: Any]?
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            Section(rewards ? "奖励方案" : "公告内容") {
                TextField("标题", text: $title)
                TextField(rewards ? "奖励理由" : "正文", text: $bodyText, axis: .vertical).lineLimit(4...12)
                if rewards {
                    TextField("每人电元", value: $electric, format: .number).keyboardType(.numberPad)
                    TextField("每人磁元", value: $magnetic, format: .number).keyboardType(.numberPad)
                } else {
                    TextField("站内链接（选填）", text: $link).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Picker("接收范围", selection: $type) { Text("全体").tag("all"); Text("指定用户").tag("users"); Text("角色").tag("role"); Text("课程管理组").tag("course") }
                    if type == "role" { Picker("角色", selection: $role) { ForEach(Array(audience.data["roles"].list.enumerated()), id: \.offset) { _, item in Text(item["name"].text).tag(item["id"].text) } } }
                    if type == "course" { Picker("课程", selection: $course) { Text("请选择").tag(""); ForEach(Array(audience.data["courses"].list.enumerated()), id: \.offset) { _, item in Text(item["name"].text).tag(item["id"].text) } } }
                }
            }.disabled(pending != nil || state.busy)
            if rewards || type == "users" {
                Section("接收用户 · 已选 \(selected.count) 人") {
                    TextField("搜索姓名、学号或用户名", text: $search)
                    Button("搜索") { Task { await loadAudience() } }
                    WorkspaceStatus(state: audience)
                    ForEach(Array(audience.data["users"].list.enumerated()), id: \.offset) { _, user in
                        Toggle(user["username"].text + " · " + user["fullName"].text, isOn: Binding(get: { selected.contains(user["id"].text) }, set: { value in if value { selected.insert(user["id"].text) } else { selected.remove(user["id"].text) } }))
                    }
                }.disabled(pending != nil || state.busy)
            }
            Section {
                if rewards { Text("合计 \(electric * selected.count) 电元 + \(magnetic * selected.count) 磁元").font(.headline) }
                if pending == nil { Button(rewards ? "核对并发放" : "核对并发布") { confirmation = true }.disabled(title.isEmpty || bodyText.isEmpty || state.busy || (rewards && (selected.isEmpty || selected.count > 100 || electric + magnetic == 0 || electric < 0 || magnetic < 0)) || (!rewards && type == "users" && selected.isEmpty) || (!rewards && type == "course" && course.isEmpty)) }
                else { Button("重试原请求") { Task { await publish() } }.disabled(state.busy); Text("保留原请求编号，重试不会重复发放。").font(.footnote).foregroundStyle(.secondary) }
            }
            Section(rewards ? "发放记录" : "邮件投递状态") {
                WorkspaceStatus(state: history)
                if rewards {
                    ForEach(Array(history.data["batches"].list.enumerated()), id: \.offset) { _, batch in
                        NavigationLink { NativeRewardReceipt(id: batch["id"].text) } label: {
                            VStack(alignment: .leading, spacing: 5) { Text(batch["title"].text).font(.headline); Text("\(batch["recipient_count"].text) 人 · \(batch["electric"].text) 电元 + \(batch["magnetic"].text) 磁元").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                } else {
                    ForEach(Array(history.data["delivery"].list.enumerated()), id: \.offset) { _, row in LabeledContent(row["status"].text + " " + row["errorCode"].text, value: row["count"].text) }
                }
                Button("刷新记录") { Task { await loadHistory() } }
            }
        }.navigationTitle(rewards ? "奖励方案" : "公告管理").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { pending = nil; selected = []; title = ""; bodyText = ""; await loadAudience(); await loadHistory() }
        .confirmationDialog(rewards ? "确认向 \(selected.count) 人发放奖励？" : "确认发布公告？", isPresented: $confirmation, titleVisibility: .visible) {
            Button(rewards ? "发放" : "发布") { prepare(); Task { await publish() } }
        }
    }
    private func prepare() {
        if rewards { pending = ["requestId": UUID().uuidString, "title": title, "reason": bodyText, "electric": electric, "magnetic": magnetic, "userIds": selected.sorted()] }
        else {
            var target: [String: Any] = ["type": type]
            if type == "users" { target["userIds"] = selected.sorted() }
            if type == "role" { target["role"] = role }
            if type == "course" { target["courseId"] = course }
            pending = ["requestId": UUID().uuidString, "title": title, "body": bodyText, "link": link, "audience": target]
        }
    }
    private func publish() async {
        guard let pending else { return }
        if let result = await state.mutate(store, path: rewards ? "/api/admin/rewards" : "/api/admin/notifications", body: pending) {
            self.pending = nil; selected = []; title = ""; bodyText = ""; state.notice = result["message"].text.isEmpty ? "操作已完成。" : result["message"].text; await loadHistory()
        }
    }
    private func loadAudience() async { await audience.load(store, path: "/api/admin/notifications/audience", query: [.init(name: "q", value: search)]) }
    private func loadHistory() async { await history.load(store, path: rewards ? "/api/admin/rewards" : "/api/admin/notifications/delivery") }
}
struct NativeRewardReceipt: View {
    @Environment(AppStore.self) private var store
    let id: String
    @State private var state = NativeWorkspace()
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            ForEach(Array(state.data["entries"].list.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 5) {
                    Text("用户 #" + row["user_id"].text).font(.headline)
                    Text("电元 \(row["electric_before"].text) → \(row["electric_after"].text)")
                    Text("磁元 \(row["magnetic_before"].text) → \(row["magnetic_after"].text)")
                }
            }
        }.navigationTitle("奖励回执 #" + id).task(id: store.sessionRevision) { await state.load(store, path: "/api/admin/rewards/" + NativeRoutes.component(id)) }
    }
}
