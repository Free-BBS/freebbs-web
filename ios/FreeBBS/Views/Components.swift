import SwiftUI

enum Palette {
    static let ink = Color.primary
    static let canvas = Color(uiColor: .systemGroupedBackground)
    static let paper = Color(uiColor: .secondarySystemGroupedBackground)
    static let teal = Color.accentColor
}
struct PageSurface<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 20) { content }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            .frame(maxWidth: 680, alignment: .leading).frame(maxWidth: .infinity) }
        .background(Palette.canvas)
        .scrollDismissesKeyboard(.interactively)
    }
}
struct Paper<Content: View>: View {
    var card: String = ""
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background { ProfileCardSurface(key: card).clipShape(RoundedRectangle(cornerRadius: 20)) }
    }
}
struct SectionTitle: View {
    let title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.title3.bold())
            if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(.secondary) }
        }.accessibilityElement(children: .combine)
    }
}
struct EmptyState: View {
    let title: String
    let symbol: String
    let message: String
    var body: some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text(message))
            .frame(maxWidth: .infinity).padding(.vertical, 20)
    }
}
struct Avatar: View {
    @Environment(AppStore.self) private var store
    let author: Author
    var size: CGFloat = 36
    var body: some View {
        Group {
            if !author.avatarPath.isEmpty, let url = AppConfiguration.safeLink(author.avatarPath, origin: store.configuration.origin) {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initials }
            } else { initials }
        }.frame(width: size, height: size).background(Palette.teal.opacity(0.1), in: Circle())
            .clipShape(Circle())
            .overlay { AvatarFrame(key: author.equipment(store.user)?.frameKey ?? "").padding(-3) }
            .accessibilityHidden(true)
    }
    private var initials: some View {
        Text(String(author.displayName.prefix(1)).uppercased()).font(.subheadline.bold()).foregroundStyle(Palette.teal)
    }
}
struct PostRow: View {
    @Environment(AppStore.self) private var store
    let post: Post
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(post.board.name).foregroundStyle(Palette.teal)
                if post.isPinned { Label("置顶", systemImage: "pin.fill").foregroundStyle(.secondary) }
                if post.isFeatured { Label("精选", systemImage: "sparkle").foregroundStyle(.secondary) }
            }.font(.caption.weight(.medium))
            Text(post.title).font(.headline).foregroundStyle(.primary).lineLimit(3).fixedSize(horizontal: false, vertical: true)
            if let excerpt = post.excerpt, !excerpt.isEmpty {
                Text(excerpt).font(.subheadline).foregroundStyle(.secondary).lineLimit(3).lineSpacing(3)
            }
            if let preview = post.preview {
                if preview.type == "image", let raw = preview.url, let url = AppConfiguration.safeLink(raw, origin: store.configuration.origin) {
                    AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: {
                        Rectangle().fill(Palette.canvas).overlay { Image(systemName: "photo").foregroundStyle(.secondary) }
                    }.frame(maxWidth: .infinity).frame(height: 150).clipped().clipShape(RoundedRectangle(cornerRadius: 14))
                        .accessibilityLabel(preview.alt ?? "讨论图片")
                } else if ["lab", "circuit", "tool"].contains(preview.type) {
                    Label(preview.type == "circuit" ? "电路与波形" : preview.type == "lab" ? "代码实验快照" : "交互小工具",
                          systemImage: preview.type == "circuit" ? "waveform.path" : preview.type == "lab" ? "terminal" : "hammer")
                        .font(.caption.weight(.medium)).foregroundStyle(Palette.teal).padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading).background(Palette.teal.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            HStack(spacing: 8) {
                Avatar(author: post.author, size: 28)
                VStack(alignment: .leading, spacing: 3) {
                    AuthorName(author: post.author).lineLimit(1)
                    Text(AppDates.short(post.createdAt)).font(.caption2)
                }
                Spacer(minLength: 8)
                Label("\(post.likeCount)", systemImage: "face.smiling")
                Label("\(post.commentCount)", systemImage: "bubble")
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle()).accessibilityElement(children: .combine)
    }
}
struct GlassAction: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if reduceTransparency { content.background(Palette.paper, in: Capsule()) }
        else { content.glassEffect(.regular.interactive(), in: Capsule()) }
    }
}
extension View {
    func glassAction() -> some View { modifier(GlassAction()) }
}

struct MarkdownContent: View {
    let source: String
    var body: some View {
        RichMarkdownContent(source: source).frame(maxWidth: .infinity, alignment: .leading)
    }
}
