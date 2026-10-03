import SwiftUI
import PhotosUI
import UIKit

struct NativeSettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var photo: PhotosPickerItem?
    @State private var preview: UIImage?
    @State private var avatarData: Data?
    @State private var state = NativeWorkspace()
    @State private var confirmLogout = false
    @AppStorage("freebbs.native.theme") private var theme = "system"
    var body: some View {
        @Bindable var store = store
        Form {
            Section("个人资料") {
                HStack(spacing: 16) {
                    if let preview { Image(uiImage: preview).resizable().scaledToFill().frame(width: 64, height: 64).clipShape(Circle()) }
                    else if let user = store.user { Avatar(author: .init(id: user.id, username: user.username, displayName: user.username, avatarPath: user.avatarPath), size: 64) }
                    PhotosPicker("选择头像", selection: $photo, matching: .images).accessibilityIdentifier("chooseAvatar")
                }
                if avatarData != nil { Button("确认上传头像") { Task { await upload() } }.disabled(state.busy) }
                LabeledContent("姓名", value: store.user?.fullName ?? "")
                NavigationLink("编辑个人资料") { EditProfileView() }
                NavigationLink("修改用户名") { ChangeUsernameView() }
                NavigationLink("邮箱与学号") { NativeIdentityView() }
                NavigationLink("修改密码") { ChangePasswordView() }
                WorkspaceStatus(state: state)
            }
            Section("界面") {
                Picker("外观", selection: $theme) { Text("跟随系统").tag("system"); Text("浅色").tag("light"); Text("深色").tag("dark") }
            }
            Section("阅读") { NavigationLink("字体与阅读大小") { NativeReadingPreferences() } }
            Section("通知") {
                NavigationLink("邮件通知偏好") { NativeMailPreferencesView() }
                NavigationLink("通知中心") { InboxView() }
            }
            Section("Max") {
                Toggle("允许 Max 处理发送的内容", isOn: $store.aiConsent).accessibilityIdentifier("maxConsentSetting")
                Text("按账号记住你的选择；关闭后停止新的 AI 请求。").font(.footnote).foregroundStyle(.secondary)
            }
            Section("隐私与账号") {
                NavigationLink("已屏蔽用户") { BlockedUsersView() }
                NavigationLink("隐私政策") { PolicyView(kind: .privacy) }
                NavigationLink("社区协议") { PolicyView(kind: .community) }
                NavigationLink("帮助与联系") { SupportView() }
                NavigationLink("删除账号") { DeleteAccountView() }.foregroundStyle(.red)
                Button("退出登录", role: .destructive) { confirmLogout = true }
            }
        }.navigationTitle("个人设置").navigationBarTitleDisplayMode(.inline)
        .onChange(of: photo) { _, value in Task {
            let session = store.sessionRevision
            do {
                guard let data = try await value?.loadTransferable(type: Data.self), data.count <= 5 * 1024 * 1024,
                      let image = UIImage(data: data) else { state.error = "请选择不超过 5 MiB 的图片。"; return }
                guard session == store.sessionRevision else { return }
                preview = image; avatarData = data; state.error = nil
            } catch { state.error = error.localizedDescription }
        } }
        .onChange(of: store.sessionRevision) { _, _ in photo = nil; preview = nil; avatarData = nil }
        .confirmationDialog("退出当前账号？", isPresented: $confirmLogout, titleVisibility: .visible) { Button("退出登录", role: .destructive) { store.logout() } }
        .onChange(of: theme) { _, value in store.saveWebPreference("free_bbs_theme_mode", value: value == "system" ? nil : value) }
    }
    private func upload() async {
        guard let image = preview, let data = image.jpegData(compressionQuality: 0.85) else { return }
        if await state.mutate(store, path: "/api/profile/avatar", body: ["imageDataUrl": "data:image/jpeg;base64," + data.base64EncodedString()]) != nil {
            avatarData = nil; preview = nil; photo = nil; state.notice = "头像已更新。"
        }
    }
}

struct NativeIdentityView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var email = ""
    @State private var code = ""
    @State private var password = ""
    @State private var studentID = ""
    var body: some View {
        Form {
            Section("验证身份") { SecureField("当前密码", text: $password).textContentType(.password) }
            Section("邮箱") {
                TextField("邮箱地址", text: $email).keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("发送验证码") { Task { if await state.mutate(store, path: "/api/profile/email-code", body: ["email": email, "currentPassword": password]) != nil { state.notice = "验证码已发送。" } } }.disabled(email.isEmpty || password.isEmpty || state.busy)
                TextField("邮箱验证码", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode)
                Button("保存邮箱") { Task { if await state.mutate(store, path: "/api/profile/email", method: "PATCH", body: ["email": email, "currentPassword": password, "emailCode": code]) != nil { password = ""; code = ""; state.notice = "邮箱已更新。" } } }.disabled(code.isEmpty || password.isEmpty || state.busy)
            }
            Section("学号") {
                TextField("学号", text: $studentID).keyboardType(.numberPad)
                Button("关联学号") { Task { if await state.mutate(store, path: "/api/profile/student-id", body: ["studentId": studentID, "currentPassword": password]) != nil { password = ""; state.notice = "学号申请已提交，请联系管理员核实归属。" } } }.disabled(studentID.isEmpty || password.isEmpty || state.busy)
            }
            WorkspaceStatus(state: state)
        }.navigationTitle("邮箱与学号").navigationBarTitleDisplayMode(.inline)
        .onAppear { email = store.user?.email ?? ""; studentID = store.user?.studentId ?? "" }
        .onDisappear { password = ""; code = "" }
    }
}
struct NativeMailPreferencesView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var values: [String: Bool] = [:]
    private let options = [("reply", "回复"), ("reaction", "帖子互动"), ("commentLike", "评论点赞"), ("announcement", "公告"), ("weeklyDigest", "每周摘要"), ("aiTask", "Max 任务")]
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            Section("通过邮件接收") {
                ForEach(options, id: \.0) { key, title in Toggle(title, isOn: Binding(get: { values[key] ?? true }, set: { values[key] = $0 })) }
            }.disabled(state.loading)
            Button("保存通知偏好") { Task {
                if await state.mutate(store, path: "/api/notifications/email-preferences", method: "PATCH", body: values.mapValues { $0 as Any }) != nil { state.notice = "邮件通知偏好已保存。" }
            } }.disabled(state.busy || state.loading || values.isEmpty)
        }.navigationTitle("邮件通知偏好").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { values = [:]; await state.load(store, path: "/api/notifications/email-preferences"); values = state.data["preferences"].fields.mapValues(\.flag) }
    }
}

struct NativeReadingPreferences: View {
    @Environment(AppStore.self) private var store
    @State private var preset = "transistor-lab"
    @State private var scale = "comfortable"
    var body: some View {
        Form {
            Picker("阅读字体", selection: $preset) {
                Text("晶体管实验室").tag("transistor-lab"); Text("中宋书房").tag("zhongsong-study")
                Text("量子黑板").tag("quantum-board"); Text("夜间示波器").tag("night-oscilloscope")
            }
            Picker("正文大小", selection: $scale) { Text("标准").tag("standard"); Text("舒适").tag("comfortable"); Text("大字").tag("large") }
            MarkdownContent(source: "## 阅读预览\n知识与讨论正文使用此偏好，并响应系统文字大小。\n\n$$E=mc^2$$")
        }.navigationTitle("字体与阅读大小").navigationBarTitleDisplayMode(.inline)
        .onAppear { let style = ReadingStyle(raw: store.webPreferenceValues["free_bbs_typography_preferences"]); preset = style.fontPreset; scale = style.typeScale }
        .onChange(of: preset) { _, _ in save() }.onChange(of: scale) { _, _ in save() }
    }
    private func save() {
        if let data = try? JSONEncoder().encode(["fontPreset": preset, "typeScale": scale]), let value = String(data: data, encoding: .utf8) { store.saveWebPreference("free_bbs_typography_preferences", value: value) }
    }
}
