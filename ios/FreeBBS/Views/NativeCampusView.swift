import SwiftUI
import WebKit

struct NativeCampusView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var semesters = NativeWorkspace()
    @State private var detail = NativeWorkspace()
    @State private var semester = ""
    @State private var authorization: ConnectorAuthorization?
    @State private var username = ""
    @State private var password = ""
    @State private var consent = false
    @State private var disconnecting = false
    @State private var syncing = false
    @State private var syncTask: Task<Void, Never>?
    private let base = "/api/workbench/connectors/tsinghua"
    private var connector: SiteRecord { state.data["connector"] }
    var body: some View {
        Form {
            Section("网络学堂") {
                LabeledContent("连接状态", value: statusLabel(connector["connection"]["status"].text))
                if !connector["connection"]["lastSuccessfulSyncAt"].text.isEmpty { LabeledContent("最近同步", value: AppDates.short(connector["connection"]["lastSuccessfulSyncAt"].text)) }
                if connector["configuration"]["authorizationKind"].text == "direct_credentials" {
                    TextField("校园账号", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username)
                    SecureField("校园密码", text: $password).textContentType(.password)
                    Toggle("同意用于本次登录与课程同步", isOn: $consent)
                    Text("密码只用于本次登录，服务器不保存密码；登录会话加密保存。可随时断开连接。").font(.footnote).foregroundStyle(.secondary)
                    Button("连接校园账号") { Task { await connectDirect() } }.disabled(state.busy || !consent || username.isEmpty || password.isEmpty || !connector["configuration"]["authorizationAvailable"].flag)
                } else {
                    Button("连接校园账号", systemImage: "link") { Task { await authorize() } }.disabled(state.busy || !connector["configuration"]["authorizationAvailable"].flag)
                }
                Button("立即同步", systemImage: "arrow.triangle.2.circlepath") { syncTask = Task { await sync() } }.disabled(syncing || state.busy || !connector["sync"]["available"].flag)
                if syncing { ProgressView("正在同步课程与作业…") }
                if connector["connection"]["status"].text != "not_connected" && connector["connection"] != .null { Button("断开连接", role: .destructive) { disconnecting = true } }
                WorkspaceStatus(state: state)
            }
            Section("学期") {
                WorkspaceStatus(state: semesters)
                if semesters.data["semesters"].list.isEmpty && !semesters.loading { Text("连接并同步后显示学期。").foregroundStyle(.secondary) }
                else { Picker("选择学期", selection: $semester) { ForEach(Array(semesters.data["semesters"].list.enumerated()), id: \.offset) { _, item in Text(item["label"].text).tag(item["id"].text) } } }
                if !semester.isEmpty { NavigationLink("课程接入预览") { NativeCourseImport(semester: semester) }; NavigationLink("作业与附件") { NativeCampusHomework(semester: semester) } }
            }
            WorkspaceStatus(state: detail)
            Section("课程") {
                ForEach(Array(detail.data["semester"]["courses"].list.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 5) { Text(item["title"].text).font(.headline); Text([item["scheduleText"].text, item["locationText"].text].filter { !$0.isEmpty }.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary) }
                }
            }
            Section("课程公告") {
                ForEach(Array(detail.data["semester"]["notifications"].list.enumerated()), id: \.offset) { _, item in VStack(alignment: .leading, spacing: 6) { Text(item["title"].text).font(.headline); Text(item["content"].text); if let url = AppConfiguration.safeLink(item["actionUrl"].text, origin: store.configuration.origin), !item["actionUrl"].text.isEmpty { Link("在网络学堂查看", destination: url) } } }
            }
        }.navigationTitle("校园课程与作业").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { username = ""; password = ""; consent = false; semester = ""; await load() }
        .task(id: semester) { if !semester.isEmpty { await detail.load(store, path: "/api/workbench/campus/semesters/" + NativeRoutes.component(semester)) } }
        .refreshable { await load() }
        .sheet(item: $authorization) { request in ConnectedAccountAuthorization(request: request) { result in
            authorization = nil
            Task { await load(); if let result { let value = URLComponents(url: result, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "result" }?.value; if value != "connected" && value != "success" { state.error = "授权未完成，请检查连接状态后重试。" } } }
        }.environment(store) }
        .confirmationDialog("断开网络学堂连接？", isPresented: $disconnecting, titleVisibility: .visible) { Button("断开连接", role: .destructive) { Task { if await state.mutate(store, path: base + "/connection", method: "DELETE") != nil { await load() } } } }
        .onDisappear { password = ""; syncTask?.cancel() }
    }
    private func load() async {
        async let status: Void = state.load(store, path: base + "/status")
        async let list: Void = semesters.load(store, path: "/api/workbench/campus/semesters")
        _ = await (status, list)
        if semester.isEmpty { semester = semesters.data["currentSemesterId"].text.isEmpty ? semesters.data["semesters"].list.first?["id"].text ?? "" : semesters.data["currentSemesterId"].text }
    }
    private func connectDirect() async {
        defer { password = "" }
        if await state.mutate(store, path: base + "/direct-login", body: ["username": username, "password": password, "consent": consent, "fingerprint": UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()]) != nil { await load() }
    }
    private func authorize() async {
        guard store.requireLogin(), !store.isDemo else { state.error = "预览模式不会连接校园账号。"; return }
        let owner = store.sessionRevision
        do {
            var cookies: [HTTPCookie] = []
            let result: SiteRecord = try await store.api.request(base + "/authorization-attempts", method: "POST", connectorCookies: { cookies = $0 })
            guard owner == store.sessionRevision, let url = URL(string: result["authorizationUrl"].text), ConnectorAuthorizationPolicy.permits(url), cookies.count == 1 else { throw APIError.invalidResponse }
            for cookie in cookies { await store.featureDataStore.httpCookieStore.setCookie(cookie) }
            guard owner == store.sessionRevision else { return }
            authorization = .init(url: url)
        } catch { if owner == store.sessionRevision { state.error = error.localizedDescription } }
    }
    private func sync() async {
        syncing = true; defer { syncing = false }
        let owner = store.sessionRevision
        guard let result = await state.mutate(store, path: base + "/sync-runs", body: semester.isEmpty ? [:] : ["semesterId": semester]), !result["run"]["publicId"].text.isEmpty else { return }
        do {
            for _ in 0..<90 {
                try await Task.sleep(for: .seconds(1)); try Task.checkCancellation()
                guard owner == store.sessionRevision else { return }
                let progress: SiteRecord = try await store.api.request(base + "/sync-runs/" + NativeRoutes.component(result["run"]["publicId"].text))
                let status = progress["run"]["status"].text
                if ["succeeded", "partial"].contains(status) { await load(); await detail.load(store, path: "/api/workbench/campus/semesters/" + NativeRoutes.component(semester)); state.notice = status == "partial" ? "部分内容已同步，请检查课程。" : "同步完成。"; return }
                if ["failed", "cancelled"].contains(status) { throw APIError.server(409, "同步未完成，请检查连接后重试。") }
            }
            state.notice = "同步仍在后台进行，可稍后刷新状态。"
        } catch { if !Task.isCancelled && owner == store.sessionRevision { state.error = error.localizedDescription } }
    }
    private func statusLabel(_ status: String) -> String { ["not_connected": "未连接", "active_verified": "已连接", "active_unverified": "已连接，等待验证", "reauthorization_required": "需要重新授权", "revoked": "已断开"][status] ?? (status.isEmpty ? "正在读取" : status) }
}

struct NativeCourseImport: View {
    @Environment(AppStore.self) private var store
    let semester: String
    @State private var state = NativeWorkspace()
    @State private var confirming = false
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            Section("接入预览") { LabeledContent("有效课次", value: state.data["scheduledLessons"].text); LabeledContent("跳过课次", value: state.data["skippedLessons"].text) }
            ForEach(Array(state.data["courses"].list.enumerated()), id: \.offset) { _, item in VStack(alignment: .leading, spacing: 5) { Text(item["title"].text).font(.headline); Text(item["schedule"].text); Text(item["location"].text).foregroundStyle(.secondary) } }
            ForEach(Array(state.data["issues"].list.enumerated()), id: \.offset) { _, item in Text(item.text.isEmpty ? item["message"].text : item.text).foregroundStyle(.orange) }
            Button("确认接入个人日程") { confirming = true }.disabled(state.loading || state.busy || state.data["revision"].text.isEmpty)
        }.navigationTitle("课程接入预览").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { await state.load(store, path: "/api/workbench/campus/course-import", query: [.init(name: "semester", value: semester)]) }
        .confirmationDialog("按预览接入课程安排？", isPresented: $confirming, titleVisibility: .visible) { Button("接入日程") { Task { if await state.mutate(store, path: "/api/workbench/campus/course-import", body: ["semesterId": semester, "revision": state.data["revision"].text]) != nil { state.notice = "课程已接入个人日程。" } } } }
    }
}

struct NativeCampusHomework: View {
    @Environment(AppStore.self) private var store
    let semester: String
    @State private var state = NativeWorkspace()
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            if !state.loading && state.data["items"].list.isEmpty { Text("该学期暂无同步作业。").foregroundStyle(.secondary) }
            ForEach(Array(state.data["items"].list.enumerated()), id: \.offset) { _, item in NavigationLink { NativeHomeworkDetail(semester: semester, reference: item["sourceReference"].text) } label: { VStack(alignment: .leading, spacing: 5) { Text(item["title"].text).font(.headline); if !item["dueAt"].text.isEmpty { Text("截止 " + AppDates.short(item["dueAt"].text)).font(.caption) }; if item["deadlineUnverified"].flag { Text("截止时间需在学堂确认").font(.caption).foregroundStyle(.orange) } } } }
        }.navigationTitle("作业与附件").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { await state.load(store, path: "/api/workbench/connectors/tsinghua/homework/semesters/" + NativeRoutes.component(semester)) }.refreshable { await state.load(store, path: "/api/workbench/connectors/tsinghua/homework/semesters/" + NativeRoutes.component(semester)) }
    }
}
struct NativeHomeworkDetail: View {
    @Environment(AppStore.self) private var store
    let semester: String
    let reference: String
    @State private var state = NativeWorkspace()
    @State private var preview: PreviewDocument?
    @State private var downloading = false
    private var path: String { "/api/workbench/connectors/tsinghua/homework/semesters/" + NativeRoutes.component(semester) + "/items/" + NativeRoutes.component(reference) }
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            Section { Text(state.data["homework"]["title"].text).font(.title2.bold()); Text(state.data["homework"]["description"].text).textSelection(.enabled) }
            Section("附件") { ForEach(Array(state.data["homework"]["attachments"].list.enumerated()), id: \.offset) { _, item in Button(item["name"].text, systemImage: "doc") { Task { await open(item) } }.disabled(downloading) } }
            if downloading { ProgressView("正在下载附件…") }
        }.navigationTitle("作业详情").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { await state.load(store, path: path) }
        .sheet(item: $preview, onDismiss: { SiteImports.purgeExpired() }) { item in DocumentPreview(url: item.url).onDisappear { SiteImports.discard([item.url]) } }
        .onChange(of: store.sessionRevision) { _, _ in if let preview { SiteImports.discard([preview.url]) }; preview = nil }
    }
    private func open(_ item: SiteRecord) async {
        downloading = true; defer { downloading = false }
        let owner = store.sessionRevision
        do { let url = try await store.api.downloadHomework(path + "/attachments/" + NativeRoutes.component(item["id"].text), name: item["name"].text)
            guard owner == store.sessionRevision && !Task.isCancelled else { SiteImports.discard([url]); return }; preview = .init(url: url)
        } catch { if owner == store.sessionRevision { state.error = error.localizedDescription } }
    }
}
