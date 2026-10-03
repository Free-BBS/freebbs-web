import SwiftUI

struct ProfileView: View {
    @Environment(AppStore.self) private var store
    @State private var confirmLogout = false
    var body: some View {
        @Bindable var store = store
        List {
            Section {
                if let user = store.user {
                    HStack(spacing: 16) {
                        Image(systemName: "person.crop.circle.fill").font(.system(size: 56)).foregroundStyle(Palette.teal).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(user.username).font(.title3.bold()).lineLimit(2)
                            Text(user.bio.isEmpty ? "保持好奇，慢慢积累。" : user.bio).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 12)
                    NavigationLink("编辑个人资料") { EditProfileView() }
                    NavigationLink("修改用户名") { ChangeUsernameView() }
                    NavigationLink("修改密码") { ChangePasswordView() }
                } else {
                    Text("把学习的足迹，留在这里。").font(.headline).padding(.vertical, 10)
                    Button("登录或注册") { store.showLogin = true }.frame(minHeight: 44).accessibilityIdentifier("profileLogin")
                }
            }
            if store.user?.requiresUsernameChange == true {
                Section { Text("请先修改用户名，仅使用英文字母、数字和下划线，才能继续使用社区功能。") }
            }
            Section("学习") {
                NavigationLink { InboxView() } label: { Label("通知", systemImage: "bell.badge") }
                NavigationLink { WorkbenchView() } label: { Label("学习日程", systemImage: "calendar") }
                NavigationLink { ChatView() } label: { Label("问问 Max", systemImage: "sparkles") }
            }
            if store.user != nil {
                Section {
                    Toggle("允许 Max 处理发送的内容", isOn: $store.aiConsent).accessibilityIdentifier("maxConsentSetting")
                } header: { Text("Max 数据使用") } footer: {
                    Text("开启后，你发送的问题、对话上下文和工具制作需求及代码会交由 FREE-BBS 配置的 AI 服务处理。此选择按账号在本机保存；关闭后，下一次使用需重新同意。撤回不会删除已发送的记录。")
                }
            }
            Section("隐私与社区") {
                if store.user != nil {
                    NavigationLink { BlockedUsersView() } label: { Label("已屏蔽用户", systemImage: "person.slash") }
                    NavigationLink { DeleteAccountView() } label: { Label("删除账号", systemImage: "person.crop.circle.badge.minus") }
                }
                NavigationLink { PolicyView(kind: .privacy) } label: { Label("隐私政策", systemImage: "hand.raised") }
                NavigationLink { PolicyView(kind: .community) } label: { Label("社区协议", systemImage: "text.document") }
                NavigationLink { SupportView() } label: { Label("帮助与联系", systemImage: "questionmark.circle") }
            }
            Section {
                HStack { Text("版本"); Spacer(); Text(version).foregroundStyle(.secondary) }
                if store.isDemo { Text("当前为界面预览模式，内容为示例，不会执行远端写入。").font(.footnote).foregroundStyle(.secondary) }
                if store.user != nil { Button("退出登录", role: .destructive) { confirmLogout = true }.frame(minHeight: 44) }
            }
        }.navigationTitle("我的")
            .confirmationDialog("退出当前账号？", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) { store.logout(); Task { await store.refreshPosts() } }
            }
    }
    private var version: String {
        let info = Bundle.main.infoDictionary ?? [:]
        return "\(info["CFBundleShortVersionString"] as? String ?? "1.0.0") (\(info["CFBundleVersion"] as? String ?? "2"))"
    }
}

struct EditProfileView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var fullName = ""
    @State private var bio = ""
    @State private var website = ""
    @State private var busy = false
    var body: some View {
        Form {
            Section { TextField("姓名", text: $fullName).textContentType(.name)
                TextField("个人简介", text: $bio, axis: .vertical).lineLimit(3...8)
                TextField("个人网页（选填）", text: $website).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled() }
            Section { Text("公开讨论中显示用户名。请避免在个人简介中填写敏感信息。").font(.footnote).foregroundStyle(.secondary) }
        }.navigationTitle("编辑个人资料").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button("保存") { Task { await save() } }.disabled(fullName.isEmpty || fullName.count > 64 || bio.count > 1000 || busy)
            } }
            .onAppear { fullName = store.user?.fullName ?? ""; bio = store.user?.bio ?? ""; website = store.user?.websiteUrl ?? "" }
    }
    private func save() async {
        guard !store.isDemo else { store.error = "预览模式不会修改资料。"; return }
        busy = true
        defer { busy = false }
        do {
            let response: UserResponse = try await store.api.request("/api/profile", method: "PATCH", body: ["fullName": fullName, "bio": bio, "websiteUrl": website])
            store.user = response.user; dismiss()
        } catch { store.error = error.localizedDescription }
    }
}
struct ChangeUsernameView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var busy = false
    var body: some View {
        Form {
            Section { TextField("新用户名", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled() }
                footer: { Text("3–64 位英文字母、数字或下划线。") }
            Button("保存用户名") { Task { await save() } }.disabled(busy || username.count < 3 || username.count > 64)
        }.navigationTitle("修改用户名").navigationBarTitleDisplayMode(.inline)
            .onAppear { username = store.user?.username ?? "" }
    }
    private func save() async {
        guard !store.isDemo else { store.error = "预览模式不会修改用户名。"; return }
        busy = true
        defer { busy = false }
        do {
            let response: AuthResponse = try await store.api.request("/api/profile/username", method: "PATCH", body: ["username": username])
            try await store.accept(response); dismiss()
        } catch { store.error = error.localizedDescription }
    }
}
struct ChangePasswordView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var busy = false
    var body: some View {
        Form {
            Section {
                SecureField("当前密码", text: $current).textContentType(.password)
                SecureField("新密码（至少 6 位）", text: $password).textContentType(.newPassword)
                SecureField("再次输入新密码", text: $confirmation).textContentType(.newPassword)
            }
            Button("修改密码") { Task { await save() } }.disabled(busy || current.isEmpty || password.count < 6 || password != confirmation)
        }.navigationTitle("修改密码").navigationBarTitleDisplayMode(.inline)
    }
    private func save() async {
        guard !store.isDemo else { store.error = "预览模式不会修改密码。"; return }
        busy = true
        defer { busy = false }
        do {
            let _: MessageResponse = try await store.api.request("/api/profile/password", method: "PATCH", body: ["currentPassword": current, "newPassword": password])
            current = ""; password = ""; confirmation = ""; dismiss()
        } catch { store.error = error.localizedDescription }
    }
}
struct BlockedUsersView: View {
    @Environment(AppStore.self) private var store
    @State private var busy = false
    var body: some View {
        List {
            if store.blocks.isEmpty { ContentUnavailableView("没有屏蔽的用户", systemImage: "person.2", description: Text("在讨论详情的内容菜单中，可以举报或屏蔽用户。")) }
            ForEach(store.blocks) { user in
                HStack {
                    Text(user.username); Spacer()
                    Button("取消屏蔽") { Task { await unblock(user) } }.disabled(busy)
                }.frame(minHeight: 44)
            }
        }.navigationTitle("已屏蔽用户").navigationBarTitleDisplayMode(.inline)
            .task { await store.refreshBlocks() }
    }
    private func unblock(_ user: BlockedUser) async {
        busy = true
        defer { busy = false }
        do {
            if !store.isDemo { let _: MessageResponse = try await store.api.request("/api/mobile/blocks/\(user.id)", method: "DELETE") }
            store.blocks.removeAll { $0.id == user.id }
        } catch { store.error = error.localizedDescription }
    }
}
struct DeleteAccountView: View {
    @Environment(AppStore.self) private var store
    @State private var password = ""
    @State private var confirmation = false
    @State private var status: DeletionResponse?
    @State private var busy = false
    var body: some View {
        Form {
            Section {
                Text("删除账号与关联数据").font(.headline)
                Text("提交后将由客服核验并处理。提交申请不会立即删除账号；你可以通过 feedback@free-bbs.cn 查询处理进度。")
                    .foregroundStyle(.secondary)
                Text("处理范围包括账号身份资料、讨论与回复、AI 对话和个人学习记录；依法必须保留的数据应在隐私政策中说明。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if status?.status == "pending" {
                Section {
                    Label("已提交删除申请", systemImage: "clock")
                    if let date = status?.requestedAt { Text("提交时间：" + AppDates.short(date)) }
                    Text("账号尚未删除，请通过帮助与联系查看处理进度。")
                }
            } else {
                Section { SecureField("输入当前密码确认身份", text: $password).textContentType(.password) }
                Button("发起账号删除申请", role: .destructive) { confirmation = true }.disabled(password.isEmpty || busy)
            }
        }.navigationTitle("删除账号").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("确认提交账号删除申请？", isPresented: $confirmation, titleVisibility: .visible) {
                Button("确认提交", role: .destructive) { Task { await submit() } }
            }.task {
                guard !store.isDemo else { return }
                do { status = try await store.api.request("/api/mobile/account-deletion") }
                catch { store.error = error.localizedDescription }
            }
    }
    private func submit() async {
        guard !store.isDemo else { store.error = "预览模式不会提交删除申请。"; return }
        busy = true
        defer { busy = false }
        do {
            status = try await store.api.request("/api/mobile/account-deletion", method: "POST", body: ["password": password, "confirm": "DELETE"])
            password = ""
        } catch { store.error = error.localizedDescription }
    }
}

struct PolicyView: View {
    enum Kind { case privacy, community }
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let kind: Kind
    var body: some View {
        PageSurface {
            Paper { MarkdownContent(source: kind == .privacy ? privacy : community) }
            if kind == .privacy, let url = store.configuration.privacyURL { Link("查看正式隐私政策", destination: url).frame(minHeight: 44) }
        }.navigationTitle(kind == .privacy ? "隐私政策" : "社区协议").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { dismiss() } } }
    }
    private var privacy: String {
        (Bundle.main.url(forResource: "PrivacyPolicy", withExtension: "md").flatMap { try? String(contentsOf: $0, encoding: .utf8) }) ?? "隐私政策未加载，请联系运营方。"
    }
    private var community: String {
        (Bundle.main.url(forResource: "CommunityAgreement", withExtension: "md").flatMap { try? String(contentsOf: $0, encoding: .utf8) }) ?? "社区协议未加载。"
    }
}
struct SupportView: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        PageSurface {
            Paper {
                SectionTitle(title: "我们愿意听见你的声音", subtitle: "问题、建议与社区反馈")
                Text("举报内容：打开讨论详情 → 右侧内容菜单 → 举报内容。\n屏蔽用户：同一菜单选择“屏蔽用户”。\n账号删除：我的 → 删除账号。")
                if !store.configuration.supportEmail.isEmpty,
                   let url = URL(string: "mailto:" + store.configuration.supportEmail) {
                    Link(destination: url) { Label("联系支持", systemImage: "envelope").frame(minHeight: 48) }
                        .accessibilityIdentifier("contactSupport")
                } else { Text("正式客服联系方式尚未配置，当前版本仅用于开发审查。").foregroundStyle(.secondary) }
            }
            Paper {
                Text("隐私与网络").font(.headline)
                Text("登录令牌存储在设备钥匙串中。退出登录会清除令牌。本客户端不请求通讯录、位置、麦克风或广告跟踪权限。")
                    .foregroundStyle(.secondary)
                Text("通知来自站内通知列表；当前版本不提供系统推送。学习日程不会写入系统日历。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("帮助与联系").navigationBarTitleDisplayMode(.inline)
    }
}
