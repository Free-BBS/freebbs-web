import Foundation
import Observation

// Variable site records (survey answers, inventory metadata and model options)
// retain their JSON types. Screens select documented fields instead of rendering HTML.
enum SiteRecord: Codable, Equatable, Sendable {
    case object([String: SiteRecord]), array([SiteRecord]), string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([SiteRecord].self) { self = .array(v) }
        else { self = .object(try c.decode([String: SiteRecord].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(v): try c.encode(v)
        case let .number(v): try c.encode(v)
        case let .string(v): try c.encode(v)
        case let .array(v): try c.encode(v)
        case let .object(v): try c.encode(v)
        }
    }
    subscript(_ key: String) -> SiteRecord { if case let .object(v) = self { return v[key] ?? .null }; return .null }
    var text: String { switch self { case let .string(v): v; case let .number(v): v.rounded() == v ? String(format: "%.0f", v) : String(v); default: "" } }
    var int: Int { Int(text) ?? 0 }
    var flag: Bool { if case let .bool(v) = self { return v }; return int != 0 }
    var list: [SiteRecord] { if case let .array(v) = self { return v }; return [] }
    var fields: [String: SiteRecord] { if case let .object(v) = self { return v }; return [:] }
    var value: Any { switch self {
    case let .object(v): v.mapValues(\.value)
    case let .array(v): v.map(\.value)
    case let .string(v): v
    case let .number(v): v
    case let .bool(v): v
    case .null: NSNull()
    } }
    static let empty = SiteRecord.object([:])
    func decoded<T: Decodable>(_ type: T.Type) throws -> T {
        // JSONEncoder also accepts null/scalar records. JSONSerialization's
        // default top-level restriction raises an Objective-C exception here.
        try JSONDecoder().decode(type, from: JSONEncoder().encode(self))
    }
}

@MainActor @Observable
final class NativeWorkspace {
    nonisolated deinit {}
    var data: SiteRecord = .empty
    var loading = false
    var busy = false
    var error: String?
    var notice: String?
    private var revision = 0
    func load(_ store: AppStore, path: String, query: [URLQueryItem] = [], demo: SiteRecord = .empty) async {
        revision += 1; let request = revision; let session = store.sessionRevision
        data = .empty; error = nil; notice = nil
        guard !store.isDemo else { data = demo; return }
        loading = true
        defer { if revision == request { loading = false } }
        do {
            let record: SiteRecord = try await store.api.request(path, query: query)
            guard !Task.isCancelled, request == revision, session == store.sessionRevision else { return }
            data = record
        } catch { if request == revision, session == store.sessionRevision, !Task.isCancelled { self.error = error.localizedDescription } }
    }
    @discardableResult func mutate(_ store: AppStore, path: String, method: String = "POST", body: [String: Any] = [:]) async -> SiteRecord? {
        guard !busy, store.requireLogin() else { return nil }
        guard !store.isDemo else { error = "预览模式不会更改线上数据。"; return nil }
        return await perform(store, path: path, method: method, body: body)
    }
    // Public activity submissions intentionally allow an unauthenticated participant.
    func perform(_ store: AppStore, path: String, method: String = "POST", body: [String: Any] = [:]) async -> SiteRecord? {
        guard !busy, !store.isDemo else { error = "预览模式不会提交线上操作。"; return nil }
        busy = true; error = nil; notice = nil; let session = store.sessionRevision
        defer { busy = false }
        do {
            let result: SiteRecord = try await store.api.request(path, method: method, body: body.isEmpty ? nil : body)
            guard !Task.isCancelled, session == store.sessionRevision else { return nil }
            if let user = try? result["user"].decoded(User.self), user.id == store.user?.id { store.user = user }
            return result
        } catch { if session == store.sessionRevision, !Task.isCancelled { self.error = error.localizedDescription }; return nil }
    }
}

enum NativeRoutes {
    static func url(_ destination: FeatureDestination, origin: URL) -> URL? { URL(string: destination.path, relativeTo: origin)?.absoluteURL }
    static func query(_ destination: FeatureDestination, _ name: String) -> String? { URLComponents(string: destination.path)?.queryItems?.first { $0.name == name }?.value }
    static func component(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "" }
}
