import SwiftUI

struct NativeGuideView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var reward = NativeWorkspace()
    @State private var index = 0
    @State private var claiming = false
    private var catalogue: SiteRecord {
        guard let url = Bundle.main.url(forResource: "NativeGuide", withExtension: "json"), let data = try? Data(contentsOf: url), let record = try? JSONDecoder().decode(SiteRecord.self, from: data) else { return .empty }
        return record
    }
    private var steps: [SiteRecord] { catalogue["steps"].list }
    var body: some View {
        List {
            Section { Label("Max 探索手册", systemImage: "sparkles").font(.title2.bold()); ProgressView(value: Double(index + 1), total: Double(max(1, steps.count))); Text("第 \(min(index + 1, steps.count)) / \(steps.count) 步").font(.caption).foregroundStyle(.secondary) }
            WorkspaceStatus(state: state)
            if steps.indices.contains(index) {
                let step = steps[index]
                Section(step["label"].text) {
                    Text(step["title"].text).font(.headline)
                    Text(step["body"].text)
                    Text(step["caption"].text).font(.footnote).foregroundStyle(.secondary)
                    if step["route"].text != "/guide" { FeatureLink(path: step["route"].text, title: "打开" + step["label"].text) }
                }
                Section {
                    if index > 0 { Button("上一步", systemImage: "chevron.left") { index -= 1; Task { await record() } } }
                    Button(index == steps.count - 1 ? "完成导引" : "下一步", systemImage: "chevron.right") { Task { if index < steps.count - 1 { index += 1; await record() } else { await record(completed: true) } } }.disabled(state.busy)
                    Button("稍后继续") { Task { await record(status: "skipped") } }.disabled(state.busy)
                }
            }
            Section("导引奖励") {
                WorkspaceStatus(state: reward)
                if reward.data["claimed"].flag { Label("奖励已领取", systemImage: "checkmark.circle") }
                else if reward.data["eligible"].flag { Button("领取导引奖励", systemImage: "gift") { claiming = true }.disabled(reward.busy) }
                else { Text("完整阅读并完成导引后，可领取一次奖励。").foregroundStyle(.secondary) }
            }
            Section { NavigationLink("浏览完整手册") { NativeInformationView(path: "/guide", title: "探索手册") } }
        }.navigationTitle("新手导引").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { index = 0; if store.user != nil { await state.load(store, path: "/api/onboarding", query: [.init(name: "version", value: catalogue["version"].text)]); index = min(max(0, state.data["step"].int), max(0, steps.count - 1)); await reward.load(store, path: "/api/onboarding/reward") } }
        .confirmationDialog("领取本账号的一次性导引奖励？", isPresented: $claiming, titleVisibility: .visible) { Button("领取奖励") { Task { if let result = await reward.mutate(store, path: "/api/onboarding/reward") { reward.data = result; let owner = store.sessionRevision; if let profile: UserResponse = try? await store.api.request("/api/auth/me"), owner == store.sessionRevision { store.user = profile.user } } } } }
    }
    private func record(completed: Bool = false, status: String = "in_progress") async {
        guard store.user != nil else { return }
        if let result = await state.mutate(store, path: "/api/onboarding", method: "PATCH", body: ["version": catalogue["version"].text, "step": index, "status": completed ? "completed" : status]) { state.data = result; if completed { state.notice = "导引已完成。"; await reward.load(store, path: "/api/onboarding/reward") } }
    }
}
