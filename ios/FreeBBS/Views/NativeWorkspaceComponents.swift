import SwiftUI

struct WorkspaceStatus: View {
    let state: NativeWorkspace
    var body: some View {
        if state.loading { ProgressView("正在加载…") }
        if let error = state.error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red).textSelection(.enabled) }
        if let notice = state.notice { Label(notice, systemImage: "checkmark.circle").foregroundStyle(.secondary) }
    }
}
struct NativeAccountRequired: View {
    @Environment(AppStore.self) private var store
    var title = "登录后继续"
    var body: some View {
        ContentUnavailableView { Label(title, systemImage: "person.crop.circle") } description: { Text("此内容只对你的账号开放。") }
        actions: { Button("登录或注册") { store.showLogin = true }.buttonStyle(.borderedProminent).accessibilityIdentifier("profileLogin") }
    }
}
struct RecordRows: View {
    let records: [SiteRecord]
    var body: some View {
        ForEach(Array(records.enumerated()), id: \.offset) { _, record in
            VStack(alignment: .leading, spacing: 5) {
                Text(record["title"].text.isEmpty ? record["name"].text : record["title"].text).font(.headline)
                if !record["description"].text.isEmpty { Text(record["description"].text).foregroundStyle(.secondary) }
            }.padding(.vertical, 4)
        }
    }
}
