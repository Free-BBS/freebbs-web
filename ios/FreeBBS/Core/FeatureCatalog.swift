import Foundation

struct SiteFeature: Decodable, Identifiable, Hashable {
    let path: String
    let title: String
    let group: String
    let symbol: String
    let detail: String
    let listed: Bool
    let admin: Bool
    let login: Bool
    let native: Bool
    var id: String { path }
}

enum FeatureCatalog {
    private struct Document: Decodable {
        let entries: [SiteFeature]
        let aliases: [String: String]
        let developmentPatterns: [String]
    }
    private static let document: Document = {
        let url = Bundle.main.url(forResource: "FeatureCatalog", withExtension: "json")!
        return try! JSONDecoder().decode(Document.self, from: Data(contentsOf: url))
    }()
    static var entries: [SiteFeature] { document.entries }
    static let groups = ["学习", "计划与活动", "社区与创作", "实验与工具", "个人与牧场", "发展端", "管理", "帮助"]
    static var navigationScript: String {
        """
        const nativePaths = \(WebContentPolicy.json(entries.map(\.path) + Array(document.aliases.keys)));
        const nativePatterns = \(WebContentPolicy.json(document.developmentPatterns));
        const nativePath = location.pathname.length > 1 ? location.pathname.replace(/\\/$/,'') : location.pathname;
        const nativePageAllowed = nativePaths.includes(nativePath) || nativePatterns.some(pattern => new RegExp(pattern).test(nativePath));
        """
    }
    static func canonicalPath(_ path: String) -> String {
        let normalized = path.count > 1 && path.hasSuffix("/") ? String(path.dropLast()) : path
        return document.aliases[normalized] ?? normalized
    }
    static func pageURL(_ url: URL, origin: URL) -> Bool {
        guard WebContentPolicy.sameOrigin(url, origin: origin) else { return false }
        let path = canonicalPath(url.path)
        guard !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { return false }
        if entries.contains(where: { $0.path == path }) { return true }
        return document.developmentPatterns.contains { path.range(of: $0, options: .regularExpression) != nil }
    }
    static func feature(for url: URL) -> SiteFeature? {
        entries.first { $0.path == canonicalPath(url.path) } ?? entries
            .filter { canonicalPath(url.path).hasPrefix($0.path + "/") && $0.path != "/" }
            .max { $0.path.count < $1.path.count }
    }
    static func visible(_ feature: SiteFeature, user: User?) -> Bool {
        feature.listed && (!feature.admin || user?.isAdmin == true)
    }
}

struct FeatureDestination: Identifiable, Hashable {
    let path: String
    let title: String
    var id: String { path }
    init(_ feature: SiteFeature) { path = feature.path; title = feature.title }
    init(path: String, title: String) { self.path = path; self.title = title }
    init?(url: URL, origin: URL) {
        guard FeatureCatalog.pageURL(url, origin: origin) else { return nil }
        path = url.absoluteString
        title = FeatureCatalog.feature(for: url)?.title ?? "FREE-BBS"
    }
    var lab: LabDestination {
        guard var components = URLComponents(string: path) else { return .init(title: title, path: path) }
        components.path = FeatureCatalog.canonicalPath(components.path)
        return .init(title: title, path: components.string ?? path)
    }
}
