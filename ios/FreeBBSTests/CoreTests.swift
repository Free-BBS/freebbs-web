import XCTest
@testable import FreeBBS

@MainActor
final class CoreTests: XCTestCase {
    let origin = URL(string: "https://www.free-bbs.cn")!
    func testSafeLinksRejectExecutableAndCredentialURLs() {
        for raw in ["javascript:alert(1)", "file:///tmp/key", "http://www.free-bbs.cn", "https://user:password@www.free-bbs.cn"] {
            XCTAssertNil(AppConfiguration.safeLink(raw, origin: origin))
        }
        XCTAssertEqual(AppConfiguration.safeLink("/world", origin: origin)?.absoluteString, "https://www.free-bbs.cn/world")
    }
    func testNotificationRoutesOnlyAcceptSameOriginDiscussionLinks() {
        XCTAssertEqual(AppConfiguration.postID(from: "/discussion?post=public-post#comment-2", origin: origin), "public-post")
        XCTAssertNil(AppConfiguration.postID(from: "https://attacker.test/discussion?post=x", origin: origin))
        XCTAssertNil(AppConfiguration.postID(from: "/profile?post=x", origin: origin))
        XCTAssertNil(AppConfiguration.postID(from: "https://www.free-bbs.cn:444/discussion?post=x", origin: origin))
    }
    func testWienBoundaryUsesServerStrictInequalities() {
        let model = AuthChallenge.Oscillator(rgOhms: 1000, rOhms: 10000, cFarads: 1e-8, rfMinOhms: 1000, rfMaxOhms: 3500, rfInitialOhms: 1500, qMin: 5)
        XCTAssertFalse(model.satisfies(2000))
        XCTAssertTrue(model.satisfies(2100))
        XCTAssertFalse(model.satisfies(2200))
        XCTAssertFalse(model.satisfies(4000))
    }
    func testWorkbenchUsesPublicIdentifiersAndNullableDeadlines() throws {
        let source = #"{"scheduleItems":[{"publicId":"schedule-1","title":"学习","description":"","startAt":"2026-10-03T01:00:00Z","endAt":"2026-10-03T02:00:00Z","status":"confirmed"}],"importantItems":[{"publicId":"todo-1","title":"复习","description":"","dueAt":null,"priority":"normal"}]}"#
        let result = try JSONDecoder().decode(WorkbenchResponse.self, from: Data(source.utf8))
        XCTAssertEqual(result.scheduleItems.first?.id, "schedule-1")
        XCTAssertNil(result.importantItems.first?.dueAt)
    }
    func testDatesSupportFractionalAndWholeSeconds() {
        XCTAssertNotNil(AppDates.parse("2026-10-03T01:00:00Z"))
        XCTAssertNotNil(AppDates.parse("2026-10-03T01:00:00.123Z"))
        XCTAssertNil(AppDates.parse("invalid"))
    }
    func testAPIEncodesQueryAndUsesBearerToken() async throws {
        let session = makeSession { request in
            XCTAssertEqual(request.url?.path, "/api/discussion/posts")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "a&b")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            return (200, #"{"posts":[]}"#)
        }
        let client = APIClient(origin: origin, session: session); client.token = "test-token"
        let response: PostsResponse = try await client.request("/api/discussion/posts", query: [.init(name: "board", value: "a&b")])
        XCTAssertTrue(response.posts.isEmpty)
    }
    func testUnauthorizedSessionTriggersLogout() async {
        let client = APIClient(origin: origin, session: makeSession { _ in (401, #"{"message":"expired"}"#) })
        var invalidated = false
        client.onUnauthorized = { invalidated = true }
        do { let _: UserResponse = try await client.request("/api/auth/me"); XCTFail("Expected unauthorized") }
        catch { XCTAssertTrue(invalidated) }
    }
    func testInvalidLoginPreservesSessionAndBackendMessage() async {
        let client = APIClient(origin: origin, session: makeSession { _ in (401, #"{"message":"密码错误"}"#) })
        var invalidated = false
        client.onUnauthorized = { invalidated = true }
        do { let _: AuthResponse = try await client.request("/api/auth/login", method: "POST", body: [:]); XCTFail("Expected error") }
        catch { XCTAssertFalse(invalidated); XCTAssertEqual(error.localizedDescription, "密码错误") }
    }
    func testAPIRejectsNonHTTPSAndEscapingPaths() async {
        let client = APIClient(origin: URL(string: "http://localhost")!)
        for path in ["/api/auth/me", "/api/../secret", "https://attacker.test/api/auth/me"] {
            do { let _: MessageResponse = try await client.request(path); XCTFail("Should reject URL") }
            catch { XCTAssertEqual(error.localizedDescription, APIError.invalidURL.localizedDescription) }
        }
    }
    func testMalformedSuccessfulResponseIsNotShownAsSuccess() async {
        let client = APIClient(origin: origin, session: makeSession { _ in (200, "<html>error</html>") })
        do { let _: PostsResponse = try await client.request("/api/discussion/posts"); XCTFail("Expected decoding error") }
        catch { XCTAssertEqual(error.localizedDescription, APIError.invalidResponse.localizedDescription) }
    }
    func testLatestAndHotFeedsDecodeAnonymousAuthorsWithoutDroppingPosts() async throws {
        // Mirrors toDiscussionPostSummary + anonymousAuthor: identity is intentionally null.
        let source = #"{"hash":"fixture","notModified":false,"nextCursor":null,"posts":[{"id":"anonymous-post","title":"匿名讨论","createdAt":"2026-10-03T02:00:00Z","board":{"slug":"all","name":"综合"},"author":{"id":null,"uid":"","username":"匿名用户","fullName":"","displayName":"匿名用户","avatarPath":""},"likeCount":0,"commentCount":1,"likedByMe":false,"isPinned":false,"isFeatured":false,"preview":null},{"id":"named-post","title":"普通讨论","createdAt":"2026-10-03T01:00:00Z","board":{"slug":"all","name":"综合"},"author":{"id":42,"username":"student","displayName":"student","avatarPath":""},"likeCount":3,"commentCount":0,"likedByMe":false,"isPinned":true,"isFeatured":false}]}"#
        let client = APIClient(origin: origin, session: makeSession { request in
            XCTAssertEqual(request.url?.path, "/api/discussion/posts")
            return (200, source)
        })
        let store = AppStore(api: client)
        for sort in ["latest", "hot"] {
            store.sort = sort
            await store.refreshPosts()
            XCTAssertNil(store.postsError)
            XCTAssertEqual(store.posts.count, 2)
            XCTAssertNil(store.posts[0].author.id)
            XCTAssertEqual(store.posts[1].author.id, 42)
            store.blocks = [.init(id: 42, username: "student")]
            XCTAssertEqual(store.visiblePosts.map(\.id), ["anonymous-post"])
        }
        await store.block(store.posts[0].author)
        XCTAssertEqual(store.blocks.map(\.id), [42])
        XCTAssertFalse(store.showLogin, "匿名作者没有可屏蔽的账号，不应弹出登录或发送请求")
    }
    func testAnonymousAndDeletedRepliesDecodeNullableIdentity() throws {
        let source = #"{"comments":[{"id":1,"parentCommentId":null,"contentMarkdown":"匿名回复","createdAt":"2026-10-03T01:00:00Z","author":{"id":null,"username":"匿名用户","displayName":"匿名用户","avatarPath":""},"isDeleted":false},{"id":2,"parentCommentId":1,"contentMarkdown":"该评论已删除","createdAt":"2026-10-03T02:00:00Z","author":{"id":null,"username":"已删除","displayName":"已删除","avatarPath":""},"isDeleted":true}]}"#
        let response = try JSONDecoder().decode(CommentsResponse.self, from: Data(source.utf8))
        XCTAssertEqual(response.comments.count, 2)
        XCTAssertNil(response.comments[0].author.id)
        XCTAssertEqual(response.comments[1].parentCommentId, 1)
        XCTAssertEqual(response.comments[1].isDeleted, true)
    }
    func testMalformedAuthorIdentityStillFailsDecoding() {
        let source = #"{"id":"invalid","username":"student","displayName":"student","avatarPath":""}"#
        XCTAssertThrowsError(try JSONDecoder().decode(Author.self, from: Data(source.utf8)))
    }
    private func makeSession(_ handler: @escaping (URLRequest) -> (Int, String)) -> URLSession {
        StubURLProtocol.handler = handler
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }
}

final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { return }
        let (status, source) = handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(source.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
