import SwiftUI

struct InboxView: View {
    @Environment(AppStore.self) private var store
    @State private var destination: String?
    @State private var loadingMore = false
    var body: some View {
        List {
            if store.user == nil {
                EmptyState(title: "把消息留给你", symbol: "bell.badge", message: "登录后查看回复、互动和课程公告。")
                Button("登录") { store.showLogin = true }.buttonStyle(.borderedProminent).controlSize(.large)
            } else if store.inbox.isEmpty { EmptyState(title: "暂时没有新通知", symbol: "bell", message: "有人回复或发布公告时，会出现在这里。") }
            else {
                ForEach(store.inbox) { item in
                    Button { Task { await open(item) } } label: {
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: item.kind == "reply" ? "bubble.left" : "bell")
                                    .font(.title3).foregroundStyle(Palette.teal).frame(width: 36)
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(item.title).font(.headline).foregroundStyle(.primary)
                                    Text(item.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(4)
                                    Text(AppDates.short(item.createdAt)).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                if item.readAt == nil { Circle().fill(Palette.teal).frame(width: 8, height: 8).accessibilityLabel("未读") }
                            }.padding(.vertical, 8)
                    }.buttonStyle(.plain).accessibilityIdentifier("notification-\(item.id)")
                }
                if store.nextInboxCursor != nil {
                    Button("加载更早的通知") {
                        loadingMore = true
                        Task { await store.refreshInbox(more: true); loadingMore = false }
                    }.frame(maxWidth: .infinity, minHeight: 48).disabled(loadingMore)
                }
            }
        }.listStyle(.insetGrouped).navigationTitle("通知")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("全部已读") { Task { await readAll() } }.disabled(store.unreadCount == 0) } }
            .navigationDestination(item: $destination) { PostDetailView(postID: $0) }
            .refreshable { await store.refreshInbox() }
            .task(id: store.sessionRevision) { await store.refreshInbox() }
    }
    private func open(_ item: InboxItem) async {
        do {
            if item.readAt == nil {
                if !store.isDemo {
                    let _: MessageResponse = try await store.api.request("/api/notifications/\(item.id)/read", method: "POST", body: [:])
                }
                if let index = store.inbox.firstIndex(where: { $0.id == item.id }) { store.inbox[index].readAt = ISO8601DateFormatter().string(from: .now) }
                store.unreadCount = max(0, store.unreadCount - 1)
            }
            if let id = AppConfiguration.postID(from: item.link, origin: store.configuration.origin) { destination = id }
            else if let url = AppConfiguration.safeLink(item.link, origin: store.configuration.origin) { await UIApplication.shared.open(url) }
        } catch { store.error = error.localizedDescription }
    }
    private func readAll() async {
        do {
            if !store.isDemo {
                let _: MessageResponse = try await store.api.request("/api/notifications/read-all", method: "POST", body: [:])
            }
            for index in store.inbox.indices { store.inbox[index].readAt = ISO8601DateFormatter().string(from: .now) }
            store.unreadCount = 0
        } catch { store.error = error.localizedDescription }
    }
}
