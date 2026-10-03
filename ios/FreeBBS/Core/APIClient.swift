import Foundation

enum APIError: LocalizedError {
    case invalidURL, unauthorized, server(Int, String), invalidResponse
    var errorDescription: String? {
        switch self {
        case .invalidURL: "服务器地址无效。"
        case .unauthorized: "登录已失效，请重新登录。"
        case let .server(_, message): message
        case .invalidResponse: "服务器返回的数据格式不受支持。"
        }
    }
}

struct AppConfiguration {
    let origin: URL
    let privacyURL: URL?
    let supportEmail: String
    init(bundle: Bundle = .main) {
        origin = URL(string: bundle.object(forInfoDictionaryKey: "FreeBBSOrigin") as? String ?? "") ?? URL(string: "https://www.free-bbs.cn")!
        privacyURL = URL(string: bundle.object(forInfoDictionaryKey: "FreeBBSPrivacyURL") as? String ?? "")
        supportEmail = bundle.object(forInfoDictionaryKey: "FreeBBSSupportEmail") as? String ?? ""
    }
    static func safeLink(_ raw: String, origin: URL) -> URL? {
        guard let url = URL(string: raw, relativeTo: origin)?.absoluteURL,
              url.scheme == "https", url.user == nil, url.password == nil else { return nil }
        return url
    }
    static func postID(from raw: String, origin: URL) -> String? {
        guard let url = safeLink(raw, origin: origin), url.host == origin.host,
              url.port == origin.port,
              url.path == "/discussion" || url.path.hasPrefix("/discussion/posts/") else { return nil }
        if url.path.hasPrefix("/discussion/posts/") { return url.lastPathComponent }
        return URLComponents(url: url, resolvingAgainstBaseURL: true)?.queryItems?
            .first(where: { $0.name == "post" })?.value
    }
}

@MainActor
final class APIClient {
    let origin: URL
    var token: String?
    private let session: URLSession
    var onUnauthorized: (() -> Void)?
    init(origin: URL, session: URLSession? = nil) {
        self.origin = origin
        if let session { self.session = session }
        else {
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = 45
            config.timeoutIntervalForResource = 120
            config.httpCookieStorage = nil
            config.urlCache = nil
            self.session = URLSession(configuration: config, delegate: SameOriginRedirectDelegate(), delegateQueue: nil)
        }
    }
    func request<T: Decodable>(_ path: String, method: String = "GET",
                               query: [URLQueryItem] = [], body: [String: Any]? = nil) async throws -> T {
        guard path.hasPrefix("/api/"), !path.contains(".."),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { throw APIError.invalidURL }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url, url.scheme == "https" else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if response.statusCode == 401 {
            // A bad password must not invalidate an existing unrelated session.
            if path.hasPrefix("/api/auth/login") || path == "/api/profile/password" {
                let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
                throw APIError.server(401, message ?? "账号或密码错误。")
            }
            onUnauthorized?()
            throw APIError.unauthorized
        }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
            throw APIError.server(response.statusCode, message ?? "服务暂时不可用，请稍后重试。")
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.invalidResponse }
    }
}

final class SameOriginRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.originalRequest?.url, let next = request.url,
              next.scheme == "https", next.host == original.host, next.port == original.port,
              next.user == nil, next.password == nil else { completionHandler(nil); return }
        completionHandler(request)
    }
}
