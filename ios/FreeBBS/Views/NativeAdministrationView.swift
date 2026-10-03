import SwiftUI

struct NativeAdministrationView: View {
    var body: some View {
        List {
            Section("社区与账号") { FeatureLink(path: "/adminusers"); FeatureLink(path: "/system-settings/announcements"); FeatureLink(path: "/system-settings/rewards"); FeatureLink(path: "/system-settings/surveys") }
            Section("服务配置") { FeatureLink(path: "/system-settings/model"); FeatureLink(path: "/system-settings/course-materials") }
        }.navigationTitle("管理员端").navigationBarTitleDisplayMode(.inline)
    }
}
struct NativeAdminSettingsView: View {
    @Environment(AppStore.self) private var store
    var materials = false
    @State private var state = NativeWorkspace()
    @State private var value = ""
    @State private var confirmDelete = false
    private var path: String { "/api/admin/system-settings/" + (materials ? "course-materials" : "model") }
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            if materials {
                Section("课程资料") { TextField("服务器资料目录", text: $value).textInputAutocapitalization(.never).autocorrectionDisabled() }
            } else {
                Section("当前配置") {
                    LabeledContent("API Base URL", value: state.data["baseUrl"].text)
                    LabeledContent("默认模型", value: state.data["model"].text)
                    Text("模型地址和默认模型由部署环境管理。").font(.footnote).foregroundStyle(.secondary)
                }
                Section("密钥") { SecureField("新的 API Key", text: $value); Button("删除保存的密钥", role: .destructive) { confirmDelete = true }.disabled(state.busy) }
            }
            Button(materials ? "保存资料目录" : "保存密钥") { Task {
                if let result = await state.mutate(store, path: path, method: "PATCH", body: materials ? ["rootDirectory": value] : ["apiKey": value]) { state.data = result; if !materials { value = "" }; state.notice = "配置已保存。" }
            } }.disabled(state.busy || state.loading || value.isEmpty)
        }.navigationTitle(materials ? "课程资料管理" : "模型与密钥").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { value = ""; await state.load(store, path: path); if materials { value = state.data["rootDirectory"].text } }
        .onDisappear { if !materials { value = "" } }
        .confirmationDialog("删除模型密钥？", isPresented: $confirmDelete, titleVisibility: .visible) { Button("删除", role: .destructive) { Task { if let result = await state.mutate(store, path: path + "/api-key", method: "DELETE") { state.data = result; state.notice = "密钥已删除。" } } } }
    }
}
struct NativeAdminUsersView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var query = ""
    @State private var edit: AdminUserSelection?
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            ForEach(Array(state.data["users"].list.filter { query.isEmpty || ($0["username"].text + $0["fullName"].text + $0["studentId"].text).localizedCaseInsensitiveContains(query) }.enumerated()), id: \.offset) { _, person in
                Button { edit = .init(record: person) } label: {
                    VStack(alignment: .leading, spacing: 5) { Text(person["username"].text).font(.headline); Text(person["fullName"].text + " · " + person["role"].text).font(.subheadline).foregroundStyle(.secondary) }.padding(.vertical, 4)
                }.buttonStyle(.plain)
            }
        }.navigationTitle("用户管理").navigationBarTitleDisplayMode(.inline).searchable(text: $query, prompt: "姓名、用户名或学号")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("创建用户", systemImage: "person.badge.plus") { edit = .init(record: .empty) } } }
        .task(id: store.sessionRevision) { await load() }.refreshable { await load() }
        .sheet(item: $edit) { selection in NavigationStack { NativeAdminUserEditor(record: selection.record, catalog: state.data["permissionCatalog"]) { Task { await load() } }.environment(store) } }
    }
    private func load() async { await state.load(store, path: "/api/admin/users") }
}
struct AdminUserSelection: Identifiable { let id = UUID(); let record: SiteRecord }
struct NativeAdminUserEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let record: SiteRecord; let catalog: SiteRecord; let saved: () -> Void
    @State private var state = NativeWorkspace()
    @State private var username = ""
    @State private var name = ""
    @State private var studentID = ""
    @State private var email = ""
    @State private var password = ""
    @State private var role = "student"
    @State private var admin = false
    @State private var electric = 0
    @State private var magnetic = 0
    @State private var heat = 0
    @State private var boards: Set<String> = []
    @State private var courses: Set<String> = []
    @State private var deletion = false
    @State private var confirmation = false
    private var existing: Bool { !record["id"].text.isEmpty }
    private var path: String { "/api/admin/users" + (existing ? "/" + NativeRoutes.component(record["id"].text) : "") }
    var body: some View {
        Form {
            Section("身份") {
                TextField("用户名", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled().disabled(existing)
                TextField("姓名", text: $name)
                if !existing {
                    TextField("学号", text: $studentID)
                    TextField("邮箱", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    SecureField("初始密码", text: $password).textContentType(.newPassword)
                }
                Picker("角色", selection: $role) { Text("学生").tag("student"); Text("教师").tag("teacher"); Text("助教").tag("ta"); Text("管理员").tag("admin") }
                Toggle("管理权限", isOn: $admin)
            }
            Section("余额") {
                TextField("电元", value: $electric, format: .number).keyboardType(.numberPad)
                TextField("磁元", value: $magnetic, format: .number).keyboardType(.numberPad)
                TextField("热力", value: $heat, format: .number).keyboardType(.numberPad)
            }
            if existing {
                Section("讨论版主") { ForEach(Array(catalog["boards"].list.enumerated()), id: \.offset) { _, item in Toggle(item["name"].text, isOn: selected(item["slug"].text, values: $boards)) } }
                Section("课程负责人") { ForEach(Array(catalog["courses"].list.enumerated()), id: \.offset) { _, item in Toggle(item["name"].text, isOn: selected(item["slug"].text, values: $courses)) } }
                Section { Button("删除用户", role: .destructive) { deletion = true } }
            }
            WorkspaceStatus(state: state)
        }.navigationTitle(existing ? "编辑用户" : "创建用户").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("保存") { confirmation = true }.disabled(state.busy || name.isEmpty || username.isEmpty || (!existing && password.count < 6) || electric < 0 || magnetic < 0) }
        }
        .onAppear { username = record["username"].text; name = record["fullName"].text; studentID = record["studentId"].text; email = record["email"].text; if existing { role = record["role"].text }; admin = record["isAdmin"].flag; electric = record["electrons"].int; magnetic = record["manetrons"].int; heat = record["heat"].int; boards = Set(record["boardModeratorSlugs"].list.map(\.text)); courses = Set(record["courseManagerSlugs"].list.map(\.text)) }
        .onDisappear { password = "" }
        .confirmationDialog("保存账号、权限与余额修改？", isPresented: $confirmation, titleVisibility: .visible) { Button("保存") { Task { await save() } } }
        .confirmationDialog("永久删除此用户？", isPresented: $deletion, titleVisibility: .visible) { Button("删除", role: .destructive) { Task { if await state.mutate(store, path: path, method: "DELETE") != nil { saved(); dismiss() } } } }
    }
    private func selected(_ key: String, values: Binding<Set<String>>) -> Binding<Bool> { .init(get: { values.wrappedValue.contains(key) }, set: { if $0 { values.wrappedValue.insert(key) } else { values.wrappedValue.remove(key) } }) }
    private func save() async {
        var body: [String: Any] = ["fullName": name, "role": role, "isAdmin": admin, "electrons": electric, "manetrons": magnetic, "heat": heat, "boardModeratorSlugs": boards.sorted(), "courseManagerSlugs": courses.sorted()]
        if !existing { body.merge(["username": username, "studentId": studentID, "email": email, "password": password]) { _, new in new } }
        if await state.mutate(store, path: path, method: existing ? "PATCH" : "POST", body: body) != nil { password = ""; saved(); dismiss() }
    }
}
