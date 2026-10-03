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
        ScrollView { VStack(alignment: .leading, spacing: 24) { content }
            .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 28)
            .frame(maxWidth: 680, alignment: .leading).frame(maxWidth: .infinity) }
        .background(Palette.canvas)
        .scrollDismissesKeyboard(.interactively)
    }
}
struct Paper<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 16) { content }
            .frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background(Palette.paper, in: RoundedRectangle(cornerRadius: 24))
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
    let author: Author
    var body: some View {
        Text(String(author.displayName.prefix(1)).uppercased()).font(.subheadline.bold())
            .frame(width: 40, height: 40).background(Palette.teal.opacity(0.1), in: Circle())
            .foregroundStyle(Palette.teal).accessibilityHidden(true)
    }
}
struct PostRow: View {
    let post: Post
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(post.board.name).foregroundStyle(Palette.teal)
                if post.isPinned { Label("置顶", systemImage: "pin.fill").foregroundStyle(.secondary) }
                if post.isFeatured { Label("精选", systemImage: "sparkle").foregroundStyle(.secondary) }
            }.font(.caption.weight(.medium))
            Text(post.title).font(.headline).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Text(post.author.displayName).lineLimit(1)
                Spacer(minLength: 8)
                Label("\(post.likeCount)", systemImage: "face.smiling")
                Label("\(post.commentCount)", systemImage: "bubble")
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading)
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

// Markdown is rendered as native text. Raw HTML never executes inside the app.
// Math/circuit embeds remain source text in this first native reader; see release checklist.
struct MarkdownContent: View {
    let source: String
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(source.components(separatedBy: "\n\n").enumerated()), id: \.offset) { _, block in
                if block.hasPrefix("```") {
                    Text(block.replacingOccurrences(of: "```", with: ""))
                        .font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                        .background(Palette.canvas, in: RoundedRectangle(cornerRadius: 12))
                } else if block.hasPrefix("#") {
                    Text(block.drop(while: { $0 == "#" || $0 == " " })).font(.title3.bold())
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text((try? AttributedString(markdown: block,
                        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(block))
                        .font(.body).lineSpacing(5).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "https", url.user == nil, url.password == nil else { return .discarded }
                return .systemAction
            })
    }
}
