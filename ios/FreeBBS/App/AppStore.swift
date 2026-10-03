import SwiftUI
import Observation

@MainActor @Observable
final class AppStore {
    let configuration = AppConfiguration()
    let api: APIClient
    private let preferences: UserDefaults
    var user: User? { didSet { aiConsent = user.map { preferences.bool(forKey: Self.aiConsentKey($0)) } ?? false } }
    var aiConsent = false { didSet { if let user, !isDemo { preferences.set(aiConsent, forKey: Self.aiConsentKey(user)) } } }
    static func aiConsentKey(_ user: User) -> String { "freebbs.ai-consent.v1." + (user.uid.isEmpty ? "id-\(user.id)" : user.uid) }
    var courses: [Course] = []
    var boards: [Board] = []
    var posts: [Post] = []
    var inbox: [InboxItem] = []
    var unreadCount = 0
    var nextInboxCursor: String?
    var blocks: [BlockedUser] = []
    var error: String?
    var showLogin = false
    var loading = false
    var selectedBoard = "all"
    var sort = "latest"
    var postsLoading = false
    var postsError: String?
    var sessionRevision = 0
    var isDemo = false
    private var postsRevision = 0
    var blockedIDs: Set<Int> { Set(blocks.map(\.id)) }
    var visiblePosts: [Post] { posts.filter { !blockedIDs.contains($0.author.id ?? 0) } }

    init(api injected: APIClient? = nil, preferences: UserDefaults = .standard) {
        self.preferences = preferences
        api = injected ?? APIClient(origin: configuration.origin)
        if injected == nil { api.token = TokenVault.read() }
        api.onUnauthorized = { [weak self] in self?.logout() }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--demo") { loadDemo() }
        #endif
    }
    func bootstrap() async {
        guard !isDemo else { return }
        loading = true
        defer { loading = false }
        if api.token != nil {
            do {
                let response: UserResponse = try await api.request("/api/auth/me")
                user = response.user
            } catch { self.error = error.localizedDescription }
        }
        do {
            let response: CoursesResponse = try await api.request("/api/courses")
            courses = response.courses
            let boardResponse: BoardsResponse = try await api.request("/api/discussion/boards")
            boards = boardResponse.boards
            if user != nil { await refreshBlocks(); await refreshInbox() }
            await refreshPosts()
        } catch { self.error = error.localizedDescription }
    }
    func accept(_ response: AuthResponse) async throws {
        try TokenVault.save(response.token)
        api.token = response.token
        user = response.user
        sessionRevision += 1
        showLogin = false
        await refreshBlocks()
        await refreshInbox()
        await refreshPosts()
    }
    func logout() {
        TokenVault.clear()
        api.token = nil
        user = nil
        inbox = []; blocks = []; unreadCount = 0; nextInboxCursor = nil
        // Remove response fields personalized for the former user before another login.
        posts = []; postsError = nil; postsLoading = false; postsRevision += 1
        sessionRevision += 1
    }
    @discardableResult func requireLogin() -> Bool {
        if user != nil { return true }
        showLogin = true
        return false
    }
    func refreshPosts() async {
        guard !isDemo else { return }
        postsLoading = true; postsError = nil
        let requestedBoard = selectedBoard; let requestedSort = sort
        postsRevision += 1
        let revision = postsRevision
        let session = sessionRevision
        defer { if revision == postsRevision { postsLoading = false } }
        do {
            let response: PostsResponse = try await api.request("/api/discussion/posts", query: [
                .init(name: "board", value: requestedBoard), .init(name: "sort", value: requestedSort),
                .init(name: "limit", value: "50")])
            guard !Task.isCancelled, revision == postsRevision, session == sessionRevision, requestedBoard == selectedBoard, requestedSort == sort else { return }
            posts = response.posts
        } catch { if !Task.isCancelled, revision == postsRevision, session == sessionRevision { postsError = error.localizedDescription } }
    }
    func refreshInbox(more: Bool = false) async {
        guard user != nil, !isDemo else { return }
        let session = sessionRevision
        do {
            var query = [URLQueryItem(name: "limit", value: "20")]
            if more, let cursor = nextInboxCursor { query.append(.init(name: "before", value: cursor)) }
            let response: InboxResponse = try await api.request("/api/notifications", query: query)
            guard session == sessionRevision else { return }
            if more {
                let existing = Set(inbox.map(\.id))
                inbox += response.notifications.filter { !existing.contains($0.id) }
            } else { inbox = response.notifications }
            unreadCount = response.unreadCount; nextInboxCursor = response.nextCursor
        } catch { self.error = error.localizedDescription }
    }
    func refreshBlocks() async {
        guard user != nil, !isDemo else { return }
        let session = sessionRevision
        do {
            let response: BlocksResponse = try await api.request("/api/mobile/blocks")
            if session == sessionRevision { blocks = response.blocks }
        } catch { self.error = error.localizedDescription }
    }
    func block(_ author: Author) async {
        guard let authorID = author.id, authorID > 0, requireLogin() else { return }
        do {
            if !isDemo {
                let _: MessageResponse = try await api.request("/api/mobile/blocks", method: "POST", body: ["userId": authorID])
            }
            if !blockedIDs.contains(authorID) { blocks.append(.init(id: authorID, username: author.username)) }
        } catch { self.error = error.localizedDescription }
    }
    #if DEBUG
    private func loadDemo() {
        isDemo = true
        api.token = nil
        user = User(id: 1, uid: "preview", username: "freebbs_preview", fullName: "预览同学", studentId: "2026000001",
                    email: nil, role: "student", isAdmin: false, bio: "让知识彼此连接。", websiteUrl: "", avatarPath: "",
                    electrons: 128, manetrons: 32, heat: 18, requiresUsernameChange: false)
        courses = [
            Course(id: 1, slug: "signals", name: "信号与系统", code: "SIGNALS", boardSlug: "signal", description: "从时域到频域，理解信号的语言。", summary: "连续与离散 · 变换与系统"),
            Course(id: 2, slug: "circuits", name: "电路原理", code: "CIRCUITS", boardSlug: "circuit", description: "探索电路中的每一条路径。", summary: "网络分析 · 动态响应"),
            Course(id: 3, slug: "math", name: "高等数学", code: "MATH", boardSlug: "math", description: "把抽象的思想，变成清晰的推导。", summary: "微积分 · 数学方法")]
        boards = [Board(id: 1, slug: "daily", name: "日常", description: "学习与生活"), Board(id: 2, slug: "signal", name: "信号", description: "信号与系统"), Board(id: 3, slug: "circuit", name: "电路", description: "电路与硬件")]
        posts = [
            Post(id: "preview-convolution", title: "如何直观地理解卷积？", createdAt: "2026-10-03T01:20:00Z", board: .init(slug: "signal", name: "信号"), author: .init(id: 2, username: "signal_explorer", displayName: "signal_explorer", avatarPath: ""), likeCount: 12, commentCount: 2, likedByMe: false, isPinned: false, isFeatured: true, contentMarkdown: "## 从滑动的窗口开始\n\n卷积可以理解为一个信号对另一个信号的加权叠加。\n\n1. 翻转一个信号。\n2. 沿时间轴平移。\n3. 计算重叠部分的乘积积分。\n\n**观察重叠区域如何变化，是建立直觉的关键。**", canDelete: false),
            Post(id: "preview-welcome", title: "新学期，一起把知识串起来", createdAt: "2026-10-02T08:00:00Z", board: .init(slug: "daily", name: "日常"), author: .init(id: 3, username: "campus_notes", displayName: "campus_notes", avatarPath: ""), likeCount: 8, commentCount: 3, likedByMe: false, isPinned: true, isFeatured: false, contentMarkdown: "欢迎来到 FREE-BBS。分享推导、记录问题，也发现一起学习的同伴。", canDelete: false)]
        inbox = [InboxItem(id: "1", kind: "reply", title: "你的讨论收到了新回复", body: "可以从两个矩形脉冲的卷积开始理解。", link: "/discussion?post=preview-convolution", readAt: nil, createdAt: "2026-10-03T02:30:00Z"), InboxItem(id: "2", kind: "announcement", title: "课程知识点已更新", body: "信号与系统新增了傅里叶变换的应用说明。", link: "/world", readAt: nil, createdAt: "2026-10-02T10:30:00Z")]
        unreadCount = inbox.count
    }
    #endif
}
