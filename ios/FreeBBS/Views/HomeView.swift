import SwiftUI

struct HomeView: View {
    @Environment(AppStore.self) private var store
    @State private var checkedIn = false
    @State private var checkingIn = false
    var body: some View {
        PageSurface {
            if store.isDemo {
                Label("界面预览 · 示例内容", systemImage: "eye")
                    .font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("demoBanner")
            }
            Text(Date.now.formatted(.dateTime.month().day().weekday(.wide)))
                .font(.subheadline).foregroundStyle(.secondary)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { maxLink; workbenchLink }
                VStack(alignment: .leading, spacing: 12) { maxLink; workbenchLink }
            }
            NavigationLink { FeaturesView() } label: {
                Label("所有功能", systemImage: "square.grid.2x2").frame(minHeight: 44)
            }.buttonStyle(.bordered).accessibilityIdentifier("allFeatures")
            if let user = store.user {
                Paper {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(user.username).font(.headline)
                            Text("学习账户").font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "leaf").font(.title).foregroundStyle(Palette.teal).accessibilityHidden(true)
                    }
                    HStack(spacing: 20) {
                        VStack(alignment: .leading) { Text("\(user.electrons)").font(.title2.bold()); Text("电元").font(.caption).foregroundStyle(.secondary) }
                        VStack(alignment: .leading) { Text("\(user.manetrons)").font(.title2.bold()); Text("磁元").font(.caption).foregroundStyle(.secondary) }
                        Spacer()
                        Button(checkedIn ? "今日已签到" : "签到") { Task { await checkIn() } }
                            .buttonStyle(.bordered).controlSize(.large).disabled(checkedIn || checkingIn)
                    }
                }
            }
            SectionTitle(title: "我的课程")
            ForEach(store.courses.prefix(2)) { course in
                NavigationLink { CourseDetailView(course: course) } label: { CourseRow(course: course) }
                    .buttonStyle(.plain)
            }
            if store.courses.isEmpty {
                if store.loading { ProgressView("正在加载课程…").frame(maxWidth: .infinity) }
                else { EmptyState(title: "课程暂未加载", symbol: "book", message: "下拉刷新，重新连接 FREE-BBS。") }
            }
            SectionTitle(title: "最新讨论")
            Paper {
                if store.visiblePosts.isEmpty { Text("还没有讨论，去分享第一个想法吧。").foregroundStyle(.secondary) }
                ForEach(store.visiblePosts.sorted { $0.createdAt > $1.createdAt }.prefix(3)) { post in
                    NavigationLink { PostDetailView(postID: post.id, initial: post) } label: { PostRow(post: post) }.buttonStyle(.plain)
                }
            }
        }
        .navigationTitle("首页")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink { ProfileView() } label: { Image(systemName: "person.crop.circle") }.accessibilityLabel("个人设置")
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { FeatureWorkspaceView(destination: .init(path: "/inventory", title: "仓库")) } label: { Image(systemName: "shippingbox") }.accessibilityLabel("仓库")
            }
            ToolbarItem(placement: .topBarTrailing) {
            NavigationLink { InboxView() } label: {
                Image(systemName: store.unreadCount > 0 ? "bell.badge" : "bell")
            }.accessibilityLabel("通知").accessibilityValue("\(store.unreadCount) 条未读通知").accessibilityIdentifier("openInbox")
        }; ToolbarItem(placement: .topBarTrailing) {
            Button { Task { await store.bootstrap() } } label: { Image(systemName: "arrow.clockwise") }
                .accessibilityLabel("刷新首页")
        } }
        .refreshable { await store.bootstrap() }
    }
    private var maxLink: some View {
        NavigationLink { ChatView() } label: {
            Label("问问 Max", systemImage: "sparkles").font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }.buttonStyle(.bordered).controlSize(.large).foregroundStyle(Palette.teal).accessibilityIdentifier("openMax")
    }
    private var workbenchLink: some View {
        NavigationLink { WorkbenchView() } label: {
            Label("学习日程", systemImage: "calendar").font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }.buttonStyle(.bordered).controlSize(.large).accessibilityIdentifier("openWorkbench")
    }
    private func checkIn() async {
        guard store.requireLogin() else { return }
        checkingIn = true
        defer { checkingIn = false }
        do {
            if !store.isDemo {
                let response: UserResponse = try await store.api.request("/api/checkin", method: "POST", body: [:])
                store.user = response.user
            }
            checkedIn = true
        } catch { store.error = error.localizedDescription }
    }
}

struct WorkbenchView: View {
    var body: some View { NativeWorkbenchView() }
}
