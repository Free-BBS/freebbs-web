import XCTest
@testable import FreeBBS

@MainActor final class LaboratoryTests: XCTestCase {
    func testPythonTraceAndResultEventsMatchRuntimeContract() throws {
        let lab = CodeLaboratory(language: .python)
        try lab.accept(Data(#"{"type":"started","id":"lab-test"}"#.utf8))
        try lab.accept(Data(#"{"type":"trace","line":4,"step":2,"function":"main","variables":[{"name":"total","type":"int","value":"12","scope":"local"}]}"#.utf8))
        XCTAssertEqual(lab.activeID, "lab-test")
        XCTAssertEqual(lab.trace?.line, 4)
        XCTAssertEqual(lab.trace?.variables?.first?.value, "12")
        try lab.accept(Data(#"{"type":"output","text":"12\n","stream":"stdout"}"#.utf8))
        try lab.accept(Data(#"{"type":"result","exitCode":0,"stdout":"12\n","stderr":""}"#.utf8))
        try lab.accept(Data(#"{"type":"saved-run","id":"lab-test"}"#.utf8))
        XCTAssertEqual(lab.console, "12\n")
        XCTAssertEqual(lab.savedRunID, "lab-test")
        XCTAssertEqual(lab.output?.exitCode, 0)
    }
    func testCompilerAndWaveformResultsDecode() throws {
        let source = #"{"exitCode":0,"assembly":{"x86":{"text":"mov eax, 49","error":""}},"waveform":{"end":20,"timescale":"1ns","signals":[{"name":"clk","width":1,"values":[[0,"0"],[5,"1"],[10,"0"]]}]}}"#
        let result = try JSONDecoder().decode(LabOutput.self, from: Data(source.utf8))
        XCTAssertEqual(result.assembly?["x86"]?.text, "mov eax, 49")
        XCTAssertEqual(result.waveform?.signals.first?.transitions.count, 3)
        XCTAssertEqual(result.waveform?.signals.first?.transitions.last?.1, "0")
    }
    func testSavedExperimentAllowsMissingResultAndOptionalParameters() throws {
        let source = #"{"experiment":{"id":"e_0123456789abcdef0123456789abcdef","title":"Example","language":"python","source":"print(1)","result":null}}"#
        let result = try JSONDecoder().decode(ExperimentResponse.self, from: Data(source.utf8))
        XCTAssertEqual(result.experiment.source, "print(1)")
        XCTAssertNil(result.experiment.result)
    }
    func testConsoleIsBoundedAndLanguageResetClearsPrivateResult() throws {
        let lab = CodeLaboratory(language: .python)
        let data = try JSONSerialization.data(withJSONObject: ["type":"output", "text":String(repeating: "x", count: 70000)])
        try lab.accept(data)
        XCTAssertEqual(lab.console.count, 64000)
        lab.reset(.cpp)
        XCTAssertTrue(lab.console.isEmpty)
        XCTAssertNil(lab.trace)
        XCTAssertNil(lab.savedRunID)
    }
    func testMaxConsentPersistsAcrossLaunchAndIsAccountScopedAndRevocable() throws {
        let suite = "freebbs-consent-test-" + UUID().uuidString
        let preferences = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let api = APIClient(origin: URL(string: "https://www.free-bbs.cn")!)
        let first = AppStore(api: api, preferences: preferences)
        let alice = consentUser(id: 100, uid: "alice")
        first.user = alice
        XCTAssertFalse(first.aiConsent)
        first.aiConsent = true
        let relaunched = AppStore(api: api, preferences: preferences)
        relaunched.user = alice
        XCTAssertTrue(relaunched.aiConsent)
        relaunched.user = consentUser(id: 101, uid: "bob")
        XCTAssertFalse(relaunched.aiConsent)
        relaunched.user = nil
        XCTAssertFalse(relaunched.aiConsent)
        relaunched.user = alice
        XCTAssertTrue(relaunched.aiConsent)
        relaunched.aiConsent = false
        first.user = alice
        XCTAssertFalse(first.aiConsent)
    }
    private func consentUser(id: Int, uid: String) -> User {
        User(id: id, uid: uid, username: uid, fullName: uid, studentId: "2026000000", email: nil, role: "student", isAdmin: false, bio: "", websiteUrl: "", avatarPath: "", electrons: 0, manetrons: 0, heat: 0, requiresUsernameChange: false)
    }
    func testLatestAndHotSelectionsReachServerAndHandleEmptyFeed() async throws {
        let requested = SortRequests()
        StubURLProtocol.handler = { @Sendable request in
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            requested.append(query.first(where: { $0.name == "sort" })?.value ?? "")
            return (200, #"{"posts":[]}"#)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        let api = APIClient(origin: URL(string: "https://www.free-bbs.cn")!, session: URLSession(configuration: configuration))
        let store = AppStore(api: api)
        store.sort = "hot"; await store.refreshPosts()
        store.sort = "latest"; await store.refreshPosts()
        XCTAssertEqual(requested.values, ["hot", "latest"])
        XCTAssertNil(store.postsError)
        XCTAssertFalse(store.postsLoading)
        XCTAssertTrue(store.posts.isEmpty)
    }
}

nonisolated private final class SortRequests: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []
    var values: [String] { lock.withLock { storage } }
    func append(_ value: String) { lock.withLock { storage.append(value) } }
}
