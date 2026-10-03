import SwiftUI

struct DiscussionView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @State private var composing = false
    private var posts: [Post] {
        store.visiblePosts.filter { (store.selectedBoard == "all" || $0.board.slug == store.selectedBoard) &&
            (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) || $0.author.username.localizedCaseInsensitiveContains(search)) }
    }
    var body: some View {
        @Bindable var store = store
        PageSurface {
            HStack {
                Menu {
                    Picker("版块", selection: $store.selectedBoard) {
                        Text("全部版块").tag("all")
                        ForEach(store.boards) { Text($0.name).tag($0.slug) }
                    }
                } label: {
                    Label(store.boards.first(where: { $0.slug == store.selectedBoard })?.name ?? "全部版块", systemImage: "line.3.horizontal.decrease")
                        .font(.subheadline.weight(.medium)).padding(.horizontal, 16).frame(minHeight: 44).glassAction()
                }
                Spacer()
                Picker("排序", selection: $store.sort) { Text("最新").tag("latest"); Text("热门").tag("hot") }
                    .pickerStyle(.menu).accessibilityLabel("讨论排序")
            }
            if posts.isEmpty { EmptyState(title: "还没有找到讨论", symbol: "bubble.left.and.text.bubble.right", message: "试试其他版块或关键词。") }
            Paper {
                ForEach(posts) { post in
                    NavigationLink { PostDetailView(postID: post.id, initial: post) } label: { PostRow(post: post) }
                        .buttonStyle(.plain).accessibilityIdentifier("post-\(post.id)")
                    if post.id != posts.last?.id { Divider() }
                }
            }
            Text("显示最近 50 条讨论。搜索当前列表中的标题与作者。")
                .font(.caption).foregroundStyle(.secondary)
        }.navigationTitle("讨论").searchable(text: $search, prompt: "搜索当前讨论")
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button { if store.requireLogin() { composing = true } } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("发表讨论").accessibilityIdentifier("composePost")
            } }
            .task(id: "\(store.selectedBoard)-\(store.sort)-\(store.sessionRevision)") { await store.refreshPosts() }
            .refreshable { await store.refreshPosts() }
            .sheet(isPresented: $composing) { NavigationStack { ComposeView() }.environment(store) }
    }
}

struct PostDetailView: View {
    @Environment(AppStore.self) private var store
    let postID: String
    var initial: Post? = nil
    @State private var post: Post?
    @State private var comments: [Comment] = []
    @State private var reply = ""
    @State private var sending = false
    @State private var reportTarget: ReportTarget?
    @State private var blockTarget: Author?
    @State private var confirmDelete = false
    @State private var loading = false
    @Environment(\.dismiss) private var dismiss
    private var current: Post? { post ?? initial }
    private var hidden: Bool { current.map { store.blockedIDs.contains($0.author.id) } ?? false }
    var body: some View {
        PageSurface {
            if hidden { EmptyState(title: "已屏蔽此作者", symbol: "person.slash", message: "可在“我的 → 已屏蔽用户”中管理。") }
            else if let post = current {
                Text(post.board.name).font(.caption.weight(.semibold)).foregroundStyle(Palette.teal)
                Text(post.title).font(.title.bold()).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Avatar(author: post.author)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(post.author.displayName).font(.subheadline.weight(.medium))
                        Text(AppDates.short(post.createdAt)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    authorMenu(post.author, target: .init(type: "post", id: post.id))
                }
                if loading && post.contentMarkdown == nil { ProgressView("正在加载正文…") }
                Paper { MarkdownContent(source: post.contentMarkdown ?? "") }
                HStack {
                    Button { Task { await react() } } label: {
                        Label("\(post.likeCount)", systemImage: post.likedByMe ? "face.smiling.fill" : "face.smiling")
                            .padding(.horizontal, 18).frame(minHeight: 48).glassAction()
                    }.buttonStyle(.plain).foregroundStyle(Palette.teal).disabled(sending).accessibilityLabel("点赞，\(post.likeCount) 次")
                    Spacer()
                    ShareLink(item: shareURL) { Label("分享", systemImage: "square.and.arrow.up") }.frame(minHeight: 44)
                }
                SectionTitle(title: "回复", subtitle: "认真提问，也认真回应")
                ForEach(comments.filter { !store.blockedIDs.contains($0.author.id) }) { comment in
                    Paper {
                        HStack {
                            Avatar(author: comment.author)
                            Text(comment.author.displayName).font(.subheadline.weight(.medium))
                            Spacer()
                            authorMenu(comment.author, target: .init(type: "comment", id: String(comment.id)))
                        }
                        if comment.parentCommentId != nil { Text("回复讨论中的评论").font(.caption).foregroundStyle(.secondary) }
                        MarkdownContent(source: comment.contentMarkdown)
                    }
                }
                if comments.isEmpty { Text("还没有回复，分享你的看法吧。").foregroundStyle(.secondary) }
            } else if loading { ProgressView("正在加载讨论…") }
            else { EmptyState(title: "无法显示讨论", symbol: "bubble", message: "帖子可能已删除，请返回刷新。") }
        }
        .navigationTitle("讨论详情").navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !hidden && current != nil {
                HStack(alignment: .bottom, spacing: 12) {
                    TextField("写下你的回复…", text: $reply, axis: .vertical).lineLimit(1...5)
                        .padding(14).background(Palette.paper, in: RoundedRectangle(cornerRadius: 22))
                        .accessibilityIdentifier("replyField")
                    Button { Task { await sendReply() } } label: {
                        Image(systemName: "arrow.up").font(.headline).frame(width: 48, height: 48).glassAction()
                    }.accessibilityLabel("发送回复").disabled(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                }.padding(.horizontal, 16).padding(.vertical, 10).background(.bar)
            }
        }
        .toolbar { if current?.canDelete == true { ToolbarItem(placement: .topBarTrailing) {
            Button("删除", role: .destructive) { confirmDelete = true }
        } } }
        .confirmationDialog("删除这条讨论？此操作无法撤销。", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("删除讨论", role: .destructive) { Task { await deletePost() } }
        }
        .confirmationDialog("屏蔽此用户后，将隐藏其讨论与回复。", isPresented: Binding(get: { blockTarget != nil }, set: { if !$0 { blockTarget = nil } }), titleVisibility: .visible) {
            Button("屏蔽用户", role: .destructive) { if let target = blockTarget { Task { await store.block(target) } }; blockTarget = nil }
        }
        .sheet(item: $reportTarget) { target in NavigationStack { ReportView(target: target) }.environment(store) }
        .task(id: store.sessionRevision) { await load() }
    }
    private var shareURL: URL {
        var components = URLComponents(url: store.configuration.origin, resolvingAgainstBaseURL: false)!
        components.path = "/discussion"; components.queryItems = [.init(name: "post", value: postID)]
        return components.url!
    }
    private func authorMenu(_ author: Author, target: ReportTarget) -> some View {
        Menu {
            Button("举报内容", systemImage: "flag") { if store.requireLogin() { reportTarget = target } }
            if author.id != store.user?.id { Button("屏蔽用户", systemImage: "person.slash", role: .destructive) { if store.requireLogin() { blockTarget = author } } }
        } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }.accessibilityLabel("内容操作")
    }
    private func load() async {
        loading = true
        defer { loading = false }
        if store.isDemo { post = store.posts.first { $0.id == postID }; return }
        let session = store.sessionRevision
        do {
            let response: PostResponse = try await store.api.request("/api/discussion/posts/\(postID)")
            let replies: CommentsResponse = try await store.api.request("/api/discussion/posts/\(postID)/comments")
            guard session == store.sessionRevision else { return }
            post = response.post; comments = replies.comments
        } catch { store.error = error.localizedDescription }
    }
    private func react() async {
        guard store.requireLogin() else { return }
        if store.isDemo { store.error = "预览模式不会发送点赞，请使用正式账号验证。"; return }
        sending = true
        defer { sending = false }
        do {
            let _: MessageResponse = try await store.api.request("/api/discussion/posts/\(postID)/like", method: "POST", body: ["reactionType": "smile"])
            await load(); await store.refreshPosts()
        } catch { store.error = error.localizedDescription }
    }
    private func sendReply() async {
        guard store.requireLogin() else { return }
        if store.isDemo { store.error = "预览模式不会发表回复。"; return }
        guard reply.count <= 5000 else { store.error = "回复不能超过 5000 个字符。"; return }
        sending = true
        defer { sending = false }
        do {
            let _: MessageResponse = try await store.api.request("/api/discussion/posts/\(postID)/comments", method: "POST", body: ["contentMarkdown": reply])
            reply = ""; await load(); await store.refreshPosts()
        } catch { store.error = error.localizedDescription }
    }
    private func deletePost() async {
        guard !store.isDemo else { return }
        do {
            let _: MessageResponse = try await store.api.request("/api/discussion/posts/\(postID)", method: "DELETE")
            await store.refreshPosts(); dismiss()
        } catch { store.error = error.localizedDescription }
    }
}

struct ComposeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var board = ""
    @State private var title = ""
    @State private var content = ""
    @State private var submitting = false
    @State private var preview = false
    @State private var confirmDiscard = false
    var body: some View {
        Form {
            Section {
                Picker("版块", selection: $board) {
                    Text("请选择").tag("")
                    ForEach(store.boards.filter { $0.slug != "changelog" || store.user?.isAdmin == true }) { Text($0.name).tag($0.slug) }
                }
                TextField("讨论标题", text: $title, axis: .vertical).lineLimit(1...3).accessibilityIdentifier("composeTitle")
            }
            Section {
                if preview { MarkdownContent(source: content).padding(.vertical, 10) }
                else { TextEditor(text: $content).frame(minHeight: 240).accessibilityLabel("讨论正文").accessibilityIdentifier("composeBody") }
            } header: { Text("正文 · 支持 Markdown") } footer: { Text("\(title.count)/120 标题字符 · \(content.count)/20000 正文字符") }
            Section {
                Text("请尊重他人，避免公开学号、邮箱或其他个人信息。违规内容可以在讨论详情中举报。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("发表讨论").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { if title.isEmpty && content.isEmpty { dismiss() } else { confirmDiscard = true } } }
                ToolbarItem(placement: .primaryAction) { Button(preview ? "编辑" : "预览") { preview.toggle() } }
                ToolbarItem(placement: .confirmationAction) { Button("发布") { Task { await publish() } }.disabled(!valid || submitting) }
            }
            .interactiveDismissDisabled(!title.isEmpty || !content.isEmpty)
            .confirmationDialog("放弃这次编辑？", isPresented: $confirmDiscard, titleVisibility: .visible) { Button("放弃", role: .destructive) { dismiss() } }
    }
    private var valid: Bool {
        !board.isEmpty && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title.count <= 120 &&
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && content.count <= 20000
    }
    private func publish() async {
        guard !store.isDemo else { store.error = "预览模式不会发表内容。"; return }
        submitting = true
        defer { submitting = false }
        do {
            let _: PostResponse = try await store.api.request("/api/discussion/posts", method: "POST", body: ["boardSlug": board, "title": title, "contentMarkdown": content])
            await store.refreshPosts(); dismiss()
        } catch { store.error = error.localizedDescription }
    }
}

struct ReportTarget: Identifiable {
    let type: String
    let id: String
}
struct ReportView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let target: ReportTarget
    @State private var reason = "abuse"
    @State private var detail = ""
    @State private var busy = false
    @State private var submitted = false
    var body: some View {
        Form {
            if submitted {
                Section { Label("举报已提交", systemImage: "checkmark.circle"); Text("管理员会在处理队列中查看这条举报。") }
            } else {
                Section {
                    Picker("举报原因", selection: $reason) {
                        Text("辱骂或骚扰").tag("abuse"); Text("不当内容").tag("inappropriate")
                        Text("垃圾信息").tag("spam"); Text("泄露个人信息").tag("privacy"); Text("其他").tag("other")
                    }
                    TextField("补充说明（选填）", text: $detail, axis: .vertical).lineLimit(3...8)
                }
                Section { Text("举报仅管理员可见。屏蔽用户可以立即隐藏该用户的内容。").font(.footnote).foregroundStyle(.secondary) }
            }
        }.navigationTitle("举报内容").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(submitted ? "完成" : "取消") { dismiss() } }
                if !submitted { ToolbarItem(placement: .confirmationAction) { Button("提交") { Task { await submit() } }.disabled(busy || detail.count > 2000) } }
            }
    }
    private func submit() async {
        guard !store.isDemo else { store.error = "预览模式不会提交举报。"; return }
        busy = true
        defer { busy = false }
        do {
            let _: MessageResponse = try await store.api.request("/api/mobile/reports", method: "POST", body: ["targetType": target.type, "targetId": target.id, "reason": reason, "detail": detail])
            submitted = true
        } catch { store.error = error.localizedDescription }
    }
}
