import SwiftUI

struct AuthorName: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    let author: Author
    var showsBadge = true
    private var gold: GoldenName? { author.golden(store.user) }
    private var plate: CosmeticItem? { CosmeticItem.item(author.equipment(store.user)?.plateKey ?? "") }
    private var goldStyle: LinearGradient {
        let colors: [Color] = scheme == .dark
            ? [.init(red: 0.95, green: 0.74, blue: 0.35), .init(red: 1, green: 0.87, blue: 0.58), .init(red: 0.94, green: 0.70, blue: 0.27)]
            : [.init(red: 0.46, green: 0.27, blue: 0.035), .init(red: 0.62, green: 0.40, blue: 0.08), .init(red: 0.50, green: 0.30, blue: 0.03)]
        return LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let gold, gold.isActive() {
                TimelineView(.explicit([Date.now, gold.deadline])) { context in
                    Text(author.displayName).foregroundStyle(gold.isActive(at: context.date) ? AnyShapeStyle(goldStyle) : AnyShapeStyle(Color.primary))
                        .accessibilityValue(gold.isActive(at: context.date) ? "金色名字" : "")
                }
            } else { Text(author.displayName) }
            if showsBadge, let plate { Nameplate(item: plate) }
        }
    }
}

struct Nameplate: View {
    let item: CosmeticItem
    var body: some View {
        Label(item.title, systemImage: item.symbol).font(.caption2.weight(.medium))
            .foregroundStyle(Palette.teal).padding(.horizontal, 8).padding(.vertical, 4)
            .background(Palette.teal.opacity(0.10), in: Capsule()).fixedSize(horizontal: false, vertical: true)
    }
}

struct AvatarFrame: View {
    let key: String
    var body: some View {
        if !key.isEmpty {
            GeometryReader { geometry in
                let size = min(geometry.size.width, geometry.size.height)
                let aurora = key == "frame_aurora"
                Circle().strokeBorder(AngularGradient(colors: [aurora ? .purple : Palette.teal, .clear, .init(red: 0.85, green: 0.68, blue: 0.34), .clear, aurora ? .purple : Palette.teal], center: .center), lineWidth: max(1.5, size * 0.04))
                if aurora {
                    Image(systemName: "sparkle").font(.system(size: max(7, size * 0.18))).foregroundStyle(.purple).position(x: size * 0.87, y: size * 0.14)
                } else {
                    Circle().fill(Palette.teal).frame(width: max(3, size * 0.09), height: max(3, size * 0.09)).position(x: size * 0.84, y: size * 0.18)
                }
            }.allowsHitTesting(false).accessibilityHidden(true)
        }
    }
}

struct ProfileCardSurface: View {
    @Environment(\.colorScheme) private var scheme
    var key: String = ""
    var body: some View {
        ZStack {
            Palette.paper
            if key == "card_blueprint" {
                (scheme == .dark ? Color(red: 0.09, green: 0.19, blue: 0.23) : Color(red: 0.88, green: 0.94, blue: 0.95))
                Canvas { context, size in
                    var lines = Path()
                    for x in stride(from: 0.0, through: Double(size.width), by: 24) { lines.move(to: .init(x: x, y: 0)); lines.addLine(to: .init(x: x, y: size.height)) }
                    for y in stride(from: 0.0, through: Double(size.height), by: 24) { lines.move(to: .init(x: 0, y: y)); lines.addLine(to: .init(x: size.width, y: y)) }
                    context.stroke(lines, with: .color(Palette.teal.opacity(0.10)), lineWidth: 0.5)
                }
            } else if key == "card_twilight" {
                LinearGradient(colors: scheme == .dark ? [.init(red: 0.20, green: 0.16, blue: 0.27), .init(red: 0.12, green: 0.20, blue: 0.25)] : [.init(red: 0.93, green: 0.90, blue: 0.96), .init(red: 0.89, green: 0.94, blue: 0.97)], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}
