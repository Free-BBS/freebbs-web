import SwiftUI

struct NativeInformationView: View {
    @Environment(AppStore.self) private var store
    let path: String
    let title: String
    private var blocks: [SiteRecord] {
        guard let url = Bundle.main.url(forResource: "NativeInformation", withExtension: "json"), let data = try? Data(contentsOf: url), let record = try? JSONDecoder().decode(SiteRecord.self, from: data) else { return [] }
        return record[path].list
    }
    var body: some View {
        List {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                VStack(alignment: .leading, spacing: 10) {
                    Text(block["text"].text).font(block["kind"].text.hasPrefix("h") ? .headline : .body).textSelection(.enabled)
                    ForEach(block["links"].list.map(\.text), id: \.self) { route in
                        if let url = URL(string: route, relativeTo: store.configuration.origin), let destination = FeatureDestination(url: url, origin: store.configuration.origin) {
                            NavigationLink(destination.title) { FeatureWorkspaceView(destination: destination) }
                        }
                    }
                }.padding(.vertical, 5)
            }
            if path == "/about" { NavigationLink("工作人员") { NativeStaffView() } }
        }.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
    }
}
struct NativeStaffView: View {
    @Environment(AppStore.self) private var store
    @State private var group = "全部"
    @State private var query = ""
    private var staff: [SiteRecord] {
        guard let url = Bundle.main.url(forResource: "StaffRoster", withExtension: "json"), let data = try? Data(contentsOf: url), let record = try? JSONDecoder().decode(SiteRecord.self, from: data) else { return [] }
        return record["members"].list.filter { (group == "全部" || $0["groups"].list.map(\.text).contains(group)) && (query.isEmpty || ($0["name"].text + $0["introduction"].text).localizedCaseInsensitiveContains(query)) }
    }
    var body: some View {
        List {
            Picker("部门", selection: $group) { ForEach(["全部", "产品设计·总负责人", "课程部", "技术部", "战略部"], id: \.self) { Text($0).tag($0) } }
            ForEach(Array(staff.enumerated()), id: \.offset) { _, member in
                HStack(alignment: .top, spacing: 14) {
                    if let url = AppConfiguration.safeLink(member["photo"].text, origin: store.configuration.origin) {
                        AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Image(systemName: "person.crop.circle") }.frame(width: 56, height: 56).clipShape(Circle())
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(member["name"].text).font(.headline)
                        Text((member["groups"].list + member["courseGroups"].list + member["generalResponsibilities"].list).map(\.text).joined(separator: " · ")).font(.caption).foregroundStyle(Palette.teal)
                        if !member["introduction"].text.isEmpty && member["introduction"].text != "【请输入文本】" { Text(member["introduction"].text).font(.subheadline).foregroundStyle(.secondary) }
                    }
                }.padding(.vertical, 6)
            }
        }.navigationTitle("工作人员").searchable(text: $query, prompt: "查找成员")
    }
}
struct NativePublicProfileView: View {
    @Environment(AppStore.self) private var store
    var uid: String? = nil
    @State private var state = NativeWorkspace()
    private var profile: SiteRecord { state.data["profile"] }
    var body: some View {
        Group {
            if uid == nil && store.user == nil { NativeAccountRequired(title: "登录后查看个人主页") }
            else { List {
                WorkspaceStatus(state: state)
                Section {
                    HStack(spacing: 14) {
                        Avatar(author: .init(id: profile["id"].int, username: profile["username"].text, displayName: profile["username"].text, avatarPath: profile["avatarPath"].text), size: 56)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(profile["username"].text).font(.title2.bold())
                            if !profile["bio"].text.isEmpty { Text(profile["bio"].text).font(.subheadline).foregroundStyle(.secondary) }
                        }
                    }.padding(.vertical, 6)
                    LabeledContent("公开帖子", value: "\(profile["postCount"].int)")
                    LabeledContent("收到的点赞", value: "\(profile["likeCount"].int)")
                    if !profile["websiteUrl"].text.isEmpty, let url = AppConfiguration.safeLink(profile["websiteUrl"].text, origin: store.configuration.origin) { Link("个人网页", destination: url) }
                }
                Section("公开动态") {
                    if profile["activity"]["visibility"].text == "private" { Text("此用户的动态未公开。").foregroundStyle(.secondary) }
                    else {
                        if let activity = ContributionActivity(profile["activity"]) { ContributionHeatmap(activity: activity) }
                        else { Text("活跃度暂未加载").foregroundStyle(.secondary) }

                    }
                }
                Section("个人空间") {
                    NavigationLink { NativeRanchView(uid: uid ?? store.user?.uid) } label: { Label("电子牧场", systemImage: "leaf") }
                    if uid == nil || uid == store.user?.uid { NavigationLink { NativeSettingsView() } label: { Label("个人设置", systemImage: "gearshape") }; NavigationLink("个人装扮") { NativeProfileExtrasView() } }
                }
            }.refreshable { await load() } }
        }.navigationTitle("个人主页").navigationBarTitleDisplayMode(.inline).task(id: store.sessionRevision) { await load() }
    }
    private func load() async { if let key = uid ?? store.user?.uid, !key.isEmpty { await state.load(store, path: "/api/users/" + NativeRoutes.component(key) + "/public-profile", demo: .object(["profile": .object(["uid": .string(key), "username": .string(store.user?.username ?? "示例同学"), "activity": ContributionActivity.preview])])) } }

}
