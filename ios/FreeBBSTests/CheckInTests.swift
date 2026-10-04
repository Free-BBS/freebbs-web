import XCTest
@testable import FreeBBS

@MainActor final class CheckInTests: XCTestCase {
    private func user(_ id: Int, magnetic: Int = 0) -> User {
        .init(id: id, uid: "u\(id)", username: "u\(id)", fullName: "同学", studentId: "2026000000", email: nil, role: "student", isAdmin: false, bio: "", websiteUrl: "", avatarPath: "", electrons: 0, manetrons: magnetic, heat: 0, requiresUsernameChange: false)
    }
    private func payload(checked: Bool, nested: Bool = false, user: User? = nil) throws -> String {
        let day = CheckInSummary.beijingDay(.now)
        let record: [String:Any] = ["date":day,"streak":3,"rewardElectrons":0,"rewardMagnetic":4,"fortuneScore":81]
        let summary: [String:Any] = ["checkedInToday":checked,"today":checked ? record : NSNull(),"todayFortune":["date":day,"score":81],"records":checked ? [record] : []]
        var value: [String:Any] = nested ? ["summary":summary,"alreadyCheckedIn":false] : summary
        if let user { value["user"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(user)) }
        return String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
    }
    private func store() -> AppStore {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubURLProtocol.self]
        let api = APIClient(origin: URL(string:"https://www.free-bbs.cn")!, session: URLSession(configuration:config))
        api.token = "alice"; let store = AppStore(api:api); store.user = user(1); return store
    }
    func testGetAndNestedPostSynchronizeReceiptWalletAndRejectDuplicateSubmission() async throws {
        let get = try payload(checked:false), post = try payload(checked:true,nested:true,user:user(1,magnetic:4))
        var posts = 0
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/checkin")
            if request.httpMethod == "POST" { posts += 1; return (200,post) }
            return (200,get)
        }
        defer { StubURLProtocol.handler = nil }
        let store = store(), state = CheckInState()
        await state.load(store); XCTAssertEqual(state.summary?.checkedInToday,false)
        async let first: Void = state.submit(store)
        async let second: Void = state.submit(store)
        _ = await (first,second)
        XCTAssertEqual(posts,1); XCTAssertEqual(state.summary?.checkedInToday,true)
        XCTAssertEqual(state.summary?.today?.reward,"4 磁元")
        XCTAssertEqual(store.user?.manetrons,4); XCTAssertTrue(state.notice?.contains("签到成功") == true)
        await state.submit(store); XCTAssertEqual(posts,1)
    }
    func testOldAccountResponseCannotOverwriteNewAccountCheckInState() async throws {
        let alice = try payload(checked:true,user:user(1,magnetic:4)), bob = try payload(checked:false,user:user(2))
        StubURLProtocol.handler = { request in
            if request.value(forHTTPHeaderField:"Authorization") == "Bearer alice" { Thread.sleep(forTimeInterval:0.2); return (200,alice) }
            return (200,bob)
        }
        defer { StubURLProtocol.handler = nil }
        let store = store(), state = CheckInState()
        let old = Task { await state.load(store) }
        try await Task.sleep(for:.milliseconds(30))
        store.user = user(2); store.api.token = "bob"
        await state.load(store); await old.value
        XCTAssertEqual(store.user?.id,2); XCTAssertEqual(store.user?.manetrons,0)
        XCTAssertEqual(state.summary?.checkedInToday,false); XCTAssertFalse(state.loading)
    }
    func testBeijingMidnightAndContributionCalendarFillMissingDaysIncludingLeapDay() throws {
        let iso = ISO8601DateFormatter()
        XCTAssertEqual(CheckInSummary.beijingDay(try XCTUnwrap(iso.date(from:"2026-10-03T15:59:59Z"))),"2026-10-03")
        XCTAssertEqual(CheckInSummary.beijingDay(try XCTUnwrap(iso.date(from:"2026-10-03T16:00:00Z"))),"2026-10-04")
        let record: SiteRecord = .object(["end":.string("2024-03-01"),"visibility":.string("members"),"days":.array([
            .object(["date":.string("2024-02-29"),"checkins":.number(1),"posts":.number(2),"comments":.number(3),"count":.number(6)]),
            .object(["date":.string("2022-01-01"),"count":.number(999)])])])
        let activity = try XCTUnwrap(ContributionActivity(record))
        XCTAssertEqual(activity.days.count,365); XCTAssertEqual(activity.days.first?.key,"2023-03-03")
        XCTAssertEqual(activity.offset,4); XCTAssertEqual(activity.days.last?.count,0); XCTAssertEqual(activity.total,6)
        let leap = try XCTUnwrap(activity.days.first { $0.key == "2024-02-29" })
        XCTAssertEqual(leap.posts,2); XCTAssertEqual(leap.comments,3); XCTAssertEqual(leap.level,3)
        XCTAssertNil(ContributionActivity(.object(["end":.string("2024-03-01"),"visibility":.string("private")])))
        XCTAssertNil(ContributionActivity(.object(["end":.string("2024-02-31")])))
    }
}
