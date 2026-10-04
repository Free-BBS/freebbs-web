import XCTest
@testable import FreeBBS

@MainActor final class CosmeticsTests: XCTestCase {
    private func user(_ id: Int = 1) -> User {
        .init(id: id, uid: "u000000\(id)", username: "student\(id)", fullName: "", studentId: "2026000000", email: nil, role: "student", isAdmin: false, bio: "", websiteUrl: "", avatarPath: "", electrons: 0, manetrons: 0, heat: 0, requiresUsernameChange: false)
    }
    func testServerDecorationFieldsRemainOptionalForLegacyAndAnonymousAuthors() throws {
        XCTAssertThrowsError(try SiteRecord.null.decoded(Cosmetics.self))
        XCTAssertEqual(try SiteRecord.string("fixture").decoded(String.self), "fixture")
        let decoder = JSONDecoder()
        let author = try decoder.decode(Author.self, from: Data(#"{"id":2,"uid":"u0000002","username":"student2","displayName":"student2","avatarPath":"","cosmetics":{"frame":"frame_aurora","nameplate":"plate_circuit_master","card":"card_twilight"},"goldenName":{"expiresAtMs":2000000010000,"serverNowMs":2000000000000,"active":true}}"#.utf8))
        XCTAssertEqual(author.equipment(nil)?.frameKey,"frame_aurora")
        XCTAssertEqual(author.equipment(nil)?.plateKey,"plate_circuit_master")
        XCTAssertTrue(author.golden(nil)?.isActive() == true)
        let anonymous = try decoder.decode(Author.self, from: Data(#"{"id":null,"username":"匿名","displayName":"匿名用户","avatarPath":"","cosmetics":{"frame":"frame_aurora"}}"#.utf8))
        XCTAssertNil(anonymous.equipment(nil)); XCTAssertNil(anonymous.golden(nil))
        let legacy = try decoder.decode(Author.self, from: Data(#"{"id":2,"username":"student2","displayName":"student2","avatarPath":""}"#.utf8))
        XCTAssertNil(legacy.cosmetics); XCTAssertNil(legacy.goldenName)
        XCTAssertEqual(Cosmetics(frame:"unknown",nameplate:"unknown",card:"unknown").frameKey,"")
        XCTAssertEqual(Cosmetics(frame:"unknown",nameplate:"unknown",card:"unknown").cardKey,"")
    }
    func testGoldenExpiryUsesServerDurationAndWalletReceiptsPreserveOnlySameAccountEquipment() {
        let now = Date(timeIntervalSince1970:1000)
        let gold = GoldenName(expiresAtMs:2000000001000,serverNowMs:2000000000000,active:true,receivedAt:now)
        XCTAssertTrue(gold.isActive(at:now.addingTimeInterval(0.5)))
        XCTAssertFalse(gold.isActive(at:now.addingTimeInterval(1)))
        XCTAssertFalse(GoldenName(expiresAtMs:1,serverNowMs:2,active:true,receivedAt:now).isActive(at:now))
        let suite = "cosmetics-" + UUID().uuidString, preferences = UserDefaults(suiteName:suite)!
        defer { preferences.removePersistentDomain(forName:suite) }
        let store = AppStore(api:APIClient(origin:URL(string:"https://www.free-bbs.cn")!),preferences:preferences)
        var decorated = user(); decorated.cosmetics = .init(frame:"frame_orbit"); decorated.goldenName = gold
        store.user = decorated; store.user = user()
        XCTAssertEqual(store.user?.cosmetics?.frameKey,"frame_orbit"); XCTAssertNotNil(store.user?.goldenName)
        var cleared = user(); cleared.cosmetics = .init(); store.user = cleared
        XCTAssertEqual(store.user?.cosmetics?.frameKey,"")
        store.user = user(2); XCTAssertNil(store.user?.cosmetics); XCTAssertNil(store.user?.goldenName)
    }
    func testWardrobeReadsCosmeticsAndOnlyEquipsOwnedMatchingItemsThenClears() async throws {
        var posts: [[String:Any]] = []
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path,"/api/profile/extras")
            if request.httpMethod == "POST" {
                var data = request.httpBody ?? Data()
                if data.isEmpty, let stream = request.httpBodyStream {
                    stream.open(); defer { stream.close() }
                    var buffer = [UInt8](repeating: 0, count: 1024)
                    while data.count < 8192 { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
                }
                guard let body = (try? JSONSerialization.jsonObject(with: data)) as? [String:Any] else { XCTFail("Missing actual equipment request body"); return (500,"{}") }
                posts.append(body); XCTAssertEqual(body["action"] as? String,"equip"); XCTAssertEqual(body["slot"] as? String,"frame")
                XCTAssertNotNil(UUID(uuidString:body["requestKey"] as? String ?? ""))
                let key = body["itemKey"] as? String ?? ""
                return (200,"{\"cosmetics\":{\"frame\":\"\(key)\"},\"owned\":[\"frame_orbit\"]}")
            }
            return (200,#"{"cosmetics":{"frame":"frame_orbit"},"owned":["frame_orbit"]}"#)
        }
        defer { StubURLProtocol.handler = nil }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubURLProtocol.self]
        let api = APIClient(origin:URL(string:"https://www.free-bbs.cn")!,session:URLSession(configuration:config));api.token="fixture"
        let store = AppStore(api:api);store.user=user();let wardrobe=WardrobeState()
        await wardrobe.load(store)
        XCTAssertEqual(wardrobe.cosmetics.frameKey,"frame_orbit");XCTAssertEqual(store.user?.cosmetics?.frameKey,"frame_orbit")
        await wardrobe.equip(store,slot:"frame",key:"frame_aurora");XCTAssertEqual(posts.count,0)
        await wardrobe.equip(store,slot:"nameplate",key:"frame_orbit");XCTAssertEqual(posts.count,0)
        await wardrobe.equip(store,slot:"frame",key:"frame_orbit");XCTAssertEqual(posts.count,1)
        await wardrobe.equip(store,slot:"frame",key:"");XCTAssertEqual(posts.count,2);XCTAssertEqual(store.user?.cosmetics?.frameKey,"")
    }
}
