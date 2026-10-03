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

struct SiteNavigationItem: Decodable, Identifiable {
    let path: String
    let title: String
    let symbol: String
    var id: String { path }
}
struct SiteNavigation: Decodable {
    let primary: [SiteNavigationItem]
    let create: [SiteNavigationItem]
    let learning: [SiteNavigationItem]
    let tools: [SiteNavigationItem]
}

enum FeatureCatalog {
    private struct Document: Decodable {
        let entries: [SiteFeature]
        let aliases: [String: String]
        let navigation: SiteNavigation
        let directory: [String]
    }
    private static let document: Document = {
        let url = Bundle.main.url(forResource: "FeatureCatalog", withExtension: "json")!
        return try! JSONDecoder().decode(Document.self, from: Data(contentsOf: url))
    }()
    static var entries: [SiteFeature] { document.entries }
    static var navigation: SiteNavigation { document.navigation }
    static var groups: [String] { document.directory }
    static var navigationScript: String {
        """
        const nativePaths = \(WebContentPolicy.json(entries.map(\.path) + Array(document.aliases.keys)));
        const nativePath = location.pathname.length > 1 ? location.pathname.replace(/\\/$/,'') : location.pathname;
        const nativePageAllowed = nativePaths.includes(nativePath);
        """
    }
    static func canonicalPath(_ path: String) -> String {
        let normalized = path.count > 1 && path.hasSuffix("/") ? String(path.dropLast()) : path
        return document.aliases[normalized] ?? normalized
    }
    static func unavailableOnPhone(_ url: URL) -> Bool {
        let path = canonicalPath(url.path)
        return path == "/development" || path == "/development.html" || path.hasPrefix("/development/")
    }
    static func pageURL(_ url: URL, origin: URL) -> Bool {
        guard WebContentPolicy.sameOrigin(url, origin: origin), !unavailableOnPhone(url) else { return false }
        let path = canonicalPath(url.path)
        guard !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { return false }
        if entries.contains(where: { $0.path == path }) { return true }
        return false
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
