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
    // Avoid SDK 27 executor-based destruction on the supported iOS 26 runtime.
    nonisolated deinit {}
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
            config.timeoutIntervalForResource = 360
            config.httpCookieStorage = nil
            config.urlCache = nil
            self.session = URLSession(configuration: config, delegate: SameOriginRedirectDelegate(), delegateQueue: nil)
        }
    }
    func stream(_ path: String, body: [String: Any], receive: (Data) throws -> Void) async throws {
        guard path == "/api/labs/run", var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { throw APIError.invalidURL }
        components.path = path
        guard let url = components.url, url.scheme == "https" else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"; request.timeoutInterval = 210
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { bytes.task.cancel(); onUnauthorized?(); throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            var message = "实验环境暂时不可用，请稍后重试。"
            for try await line in bytes.lines {
                if line.utf8.count < 4096, let data = line.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) as? [String:Any] { message = json["message"] as? String ?? message }
                break
            }
            bytes.task.cancel(); throw APIError.server(http.statusCode, message)
        }
        try await withTaskCancellationHandler {
            var total = 0
            for try await line in bytes.lines {
                try Task.checkCancellation()
                let data = Data(line.utf8); total += data.count
                guard data.count <= 2 * 1024 * 1024, total <= 12 * 1024 * 1024 else { bytes.task.cancel(); throw APIError.invalidResponse }
                if !line.trimmingCharacters(in: .whitespaces).isEmpty { try receive(data) }
            }
        } onCancel: { bytes.task.cancel() }
    }
    func request<T: Decodable>(_ path: String, method: String = "GET",
                               query: [URLQueryItem] = [], body: [String: Any]? = nil, timeout: TimeInterval = 45,
                               connectorCookies: (([HTTPCookie]) -> Void)? = nil) async throws -> T {
        guard path.hasPrefix("/api/"), !path.contains(".."),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { throw APIError.invalidURL }
        guard let route = URLComponents(string: path), route.scheme == nil, route.host == nil, route.query == nil, route.fragment == nil, !route.path.contains("..") else { throw APIError.invalidURL }
        components.percentEncodedPath = route.percentEncodedPath
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url, url.scheme == "https" else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
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
            if path.hasPrefix("/api/auth/login") || ["/api/profile/password", "/api/profile/email-code", "/api/profile/email", "/api/profile/student-id"].contains(path) {
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
        if path == "/api/workbench/connectors/tsinghua/authorization-attempts", let connectorCookies {
            let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in result[String(describing: pair.key)] = String(describing: pair.value) }
            let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url).filter {
                $0.name == "freebbs_tsinghua_authorization" && $0.isSecure &&
                $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == origin.host &&
                $0.path == "/api/workbench/connectors/tsinghua/callback"
            }
            connectorCookies(cookies)
        }
        do { return try JSONDecoder().decode(T.self, from: response.statusCode == 204 && data.isEmpty ? Data("{}".utf8) : data) }
        catch { throw APIError.invalidResponse }
    }

    func downloadHomework(_ path: String, name: String) async throws -> URL {
        guard path.hasPrefix("/api/workbench/connectors/tsinghua/homework/semesters/"),
              path.contains("/attachments/"), let route = URLComponents(string: path),
              route.query == nil, route.fragment == nil, !route.path.contains(".."),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              let owner = token else { throw APIError.invalidURL }
        components.percentEncodedPath = route.percentEncodedPath; components.query = nil
        guard let url = components.url, url.scheme == "https" else { throw APIError.invalidURL }
        let delegate = LimitedHomeworkDownload()
        let config = URLSessionConfiguration.ephemeral; config.urlCache = nil; config.httpCookieStorage = nil
        let download = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        defer { download.invalidateAndCancel() }
        var request = URLRequest(url: url); request.timeoutInterval = 120
        request.setValue("Bearer " + owner, forHTTPHeaderField: "Authorization")
        let (temporary, response) = try await download.download(for: request)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard owner == token else { throw APIError.unauthorized }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { onUnauthorized?(); throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode),
              !(http.mimeType ?? "").contains("text/html"), !(http.mimeType ?? "").contains("application/json"),
              let size = (try temporary.resourceValues(forKeys: [.fileSizeKey])).fileSize,
              size > 0, size <= 50 * 1024 * 1024 else { throw APIError.invalidResponse }
        let directory = try SiteImports.directory()
        let basename = String(URL(fileURLWithPath: name).lastPathComponent.prefix(120))
        let destination = directory.appendingPathComponent(basename.isEmpty || basename == "." || basename == ".." ? "attachment" : basename)
        do { try FileManager.default.moveItem(at: temporary, to: destination); return destination }
        catch { SiteImports.discard([directory]); throw error }
    }

    func parseMaxFile(_ file: URL, progress: (Double) -> Void) async throws -> SiteRecord {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        let size = try handle.seekToEnd(); try handle.seek(toOffset: 0)
        guard size > 0, size <= 100 * 1024 * 1024 else { throw APIError.server(413, "单个文件最多 100 MB。") }
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        components.path = "/api/ai/files/parse"; components.queryItems = [.init(name: "name", value: file.lastPathComponent)]
        guard let url = components.url, url.scheme == "https" else { throw APIError.invalidURL }
        let uploadID = UUID().uuidString; let ownerToken = token
        var offset: UInt64 = 0
        while offset < size {
            try Task.checkCancellation()
            guard token == ownerToken else { throw APIError.unauthorized }
            guard let chunk = try handle.read(upToCount: 4 * 1024 * 1024), !chunk.isEmpty else { throw APIError.invalidResponse }
            var request = URLRequest(url: url); request.httpMethod = "POST"; request.httpBody = chunk; request.timeoutInterval = 180
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue(uploadID, forHTTPHeaderField: "X-Upload-ID")
            request.setValue(String(offset), forHTTPHeaderField: "X-Upload-Offset")
            request.setValue(String(size), forHTTPHeaderField: "X-Upload-Size")
            if let ownerToken { request.setValue("Bearer " + ownerToken, forHTTPHeaderField: "Authorization") }
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
            if http.statusCode == 401 { onUnauthorized?(); throw APIError.unauthorized }
            guard (200..<300).contains(http.statusCode) else {
                let result = try? JSONDecoder().decode(SiteRecord.self, from: data)
                throw APIError.server(http.statusCode, result?["message"].text ?? "文件解析失败。")
            }
            let result = try JSONDecoder().decode(SiteRecord.self, from: data)
            offset += UInt64(chunk.count); progress(Double(offset) / Double(size))
            if offset == size { return result }
        }
        throw APIError.invalidResponse
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

nonisolated final class LimitedHomeworkDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > 50 * 1024 * 1024 || totalBytesExpectedToWrite > 50 * 1024 * 1024 { downloadTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let first = task.originalRequest?.url, let next = request.url, next.scheme == "https", next.host == first.host, next.port == first.port, next.user == nil, next.password == nil else { completionHandler(nil); return }
        completionHandler(request)
    }
}
