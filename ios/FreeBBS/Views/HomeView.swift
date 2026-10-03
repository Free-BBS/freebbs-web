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
                        VStack(alignment: .leading) { Text("\(user.electrons)").font(.title2.bold()); Text("电子").font(.caption).foregroundStyle(.secondary) }
                        VStack(alignment: .leading) { Text("\(user.manetrons)").font(.title2.bold()); Text("磁子").font(.caption).foregroundStyle(.secondary) }
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
        .navigationTitle("今日")
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
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
    @Environment(AppStore.self) private var store
    @State private var summary: WorkbenchResponse?
    @State private var loading = false
    var body: some View {
        PageSurface {
            SectionTitle(title: "留出时间，专注学习", subtitle: "未来七天的日程与重要事项")
            if store.user == nil {
                EmptyState(title: "登录后查看日程", symbol: "calendar.badge.clock", message: "你的学习工作台只对你可见。")
                Button("登录") { store.showLogin = true }.buttonStyle(.borderedProminent).controlSize(.large)
            } else if loading { ProgressView("正在加载日程…") }
            else {
                Paper {
                    SectionTitle(title: "日程")
                    if summary?.scheduleItems.isEmpty != false { Text("未来七天暂无日程。").foregroundStyle(.secondary) }
                    ForEach(summary?.scheduleItems ?? []) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(item.title).font(.headline)
                            Text(AppDates.short(item.startAt) + " — " + AppDates.short(item.endAt))
                                .font(.subheadline).foregroundStyle(Palette.teal)
                            if !item.description.isEmpty { Text(item.description).foregroundStyle(.secondary) }
                        }.padding(.vertical, 8)
                    }
                }
                Paper {
                    SectionTitle(title: "重要事项")
                    if summary?.importantItems.isEmpty != false { Text("没有待办事项，留一点时间给自己。").foregroundStyle(.secondary) }
                    ForEach(summary?.importantItems ?? []) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            Label(item.title, systemImage: "flag").font(.headline)
                            Text(item.description).foregroundStyle(.secondary)
                            if let due = item.dueAt { Text("截止 " + AppDates.short(due)).font(.caption) }
                        }
                    }
                }
            }
        }.navigationTitle("学习日程").navigationBarTitleDisplayMode(.inline)
            .task(id: store.sessionRevision) { await load() }.refreshable { await load() }
    }
    private func load() async {
        summary = nil
        guard store.user != nil else { return }
        if store.isDemo {
            summary = .init(scheduleItems: [.init(publicId: "preview-schedule", title: "信号与系统 · 卷积复习", description: "从两个矩形脉冲的卷积开始。", startAt: "2026-10-03T11:00:00Z", endAt: "2026-10-03T12:00:00Z", status: "confirmed")], importantItems: [])
            return
        }
        loading = true
        defer { loading = false }
        let session = store.sessionRevision
        let formatter = ISO8601DateFormatter()
        let query = [URLQueryItem(name: "start", value: formatter.string(from: .now)),
                     URLQueryItem(name: "end", value: formatter.string(from: .now.addingTimeInterval(7 * 86400)))]
        do {
            let result: WorkbenchResponse = try await store.api.request("/api/workbench/summary", query: query)
            if session == store.sessionRevision { summary = result }
        } catch { store.error = error.localizedDescription }
    }
}
