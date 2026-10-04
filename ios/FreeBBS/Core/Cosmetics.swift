import Foundation

struct Cosmetics: Codable, Hashable {
    var frame: String? = nil
    var nameplate: String? = nil
    var card: String? = nil
    var frameKey: String { ["frame_orbit", "frame_aurora"].contains(frame ?? "") ? frame! : "" }
    var plateKey: String { CosmeticItem.items.contains { $0.slot == "nameplate" && $0.id == nameplate } ? nameplate! : "" }
    var cardKey: String { ["card_blueprint", "card_twilight"].contains(card ?? "") ? card! : "" }
    func key(_ slot: String) -> String { slot == "frame" ? frameKey : slot == "nameplate" ? plateKey : slot == "card" ? cardKey : "" }
}

struct CosmeticItem: Identifiable {
    let id: String
    let slot: String
    let title: String
    let symbol: String
    static let items: [Self] = [
        .init(id: "frame_orbit", slot: "frame", title: "环流轨道", symbol: "circle.dotted"),
        .init(id: "frame_aurora", slot: "frame", title: "极光回路", symbol: "sparkles"),
        .init(id: "plate_maxwell", slot: "nameplate", title: "麦克斯韦亲传", symbol: "bolt"),
        .init(id: "plate_observer", slot: "nameplate", title: "BBS见习观察员", symbol: "eye"),
        .init(id: "plate_fishbone_master", slot: "nameplate", title: "鱼骨达人", symbol: "fish"),
        .init(id: "plate_circuit_master", slot: "nameplate", title: "电路达人", symbol: "waveform.path"),
        .init(id: "card_blueprint", slot: "card", title: "未完成的蓝图", symbol: "square.grid.3x3"),
        .init(id: "card_twilight", slot: "card", title: "暮色实验室", symbol: "sun.horizon")
    ]
    static func item(_ key: String) -> Self? { items.first { $0.id == key } }
    var achievement: String? {
        id == "plate_fishbone_master" ? "累计购买 10 个坚硬鱼骨，并拥有至少 3 个黄金鱼骨、10 个普通鱼骨后自动获得。"
            : id == "plate_circuit_master" ? "通过电路闯关全部当前开放关卡，以当前题目版本的服务端记录为准。" : nil
    }
}

struct GoldenName: Codable, Hashable {
    let expiresAtMs: Double
    let serverNowMs: Double
    let active: Bool
    private let receivedAt: Date
    enum CodingKeys: String, CodingKey { case expiresAtMs, serverNowMs, active }
    init(expiresAtMs: Double, serverNowMs: Double, active: Bool, receivedAt: Date = .now) {
        self.expiresAtMs = expiresAtMs; self.serverNowMs = serverNowMs; self.active = active; self.receivedAt = receivedAt
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        expiresAtMs = try c.decode(Double.self, forKey: .expiresAtMs)
        serverNowMs = try c.decode(Double.self, forKey: .serverNowMs)
        active = try c.decode(Bool.self, forKey: .active); receivedAt = .now
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(expiresAtMs, forKey: .expiresAtMs); try c.encode(serverNowMs, forKey: .serverNowMs); try c.encode(active, forKey: .active)
    }
    var deadline: Date { receivedAt.addingTimeInterval(max(0, (expiresAtMs - serverNowMs) / 1000)) }
    func isActive(at date: Date = .now) -> Bool {
        active && expiresAtMs.isFinite && serverNowMs.isFinite && serverNowMs > 0 && expiresAtMs > serverNowMs && date < deadline
    }
}

extension User {
    var author: Author { .init(id: id, username: username, displayName: username, avatarPath: avatarPath, uid: uid, cosmetics: cosmetics, goldenName: goldenName) }
}
extension Author {
    init(profile: SiteRecord) {
        id = profile["id"].int > 0 ? profile["id"].int : nil
        username = profile["username"].text; displayName = username; avatarPath = profile["avatarPath"].text
        uid = profile["uid"].text
        cosmetics = try? profile["cosmetics"].decoded(Cosmetics.self)
        goldenName = try? profile["goldenName"].decoded(GoldenName.self)
    }
    func equipment(_ user: User?) -> Cosmetics? { guard let id, id > 0 else { return nil }; return id == user?.id ? user?.cosmetics ?? cosmetics : cosmetics }
    func golden(_ user: User?) -> GoldenName? { guard let id, id > 0 else { return nil }; return id == user?.id ? user?.goldenName ?? goldenName : goldenName }
}

@MainActor final class WardrobeState {
    nonisolated deinit {}
    let workspace = NativeWorkspace()
    var cosmetics: Cosmetics { (try? workspace.data["cosmetics"].decoded(Cosmetics.self)) ?? .init() }
    var owned: Set<String> { Set(workspace.data["owned"].list.map(\.text)) }
    func load(_ store: AppStore) async {
        guard let owner = store.user?.id else { workspace.data = .empty; return }
        let session = store.sessionRevision, equipment = store.equipmentRevision
        let preview: SiteRecord = .object(["cosmetics": .object(["frame": .string("frame_aurora"), "nameplate": .string("plate_observer"), "card": .string("card_blueprint")]), "owned": .array(CosmeticItem.items.map { .string($0.id) })])
        await workspace.load(store, path: "/api/profile/extras", demo: preview)
        guard owner == store.user?.id, session == store.sessionRevision, equipment == store.equipmentRevision, workspace.error == nil, !Task.isCancelled else { return }
        store.user?.cosmetics = cosmetics
    }
    func equip(_ store: AppStore, slot: String, key: String) async {
        guard !workspace.busy, !workspace.loading, let owner = store.user?.id else { return }
        guard ["frame", "nameplate", "card"].contains(slot), key.isEmpty || (owned.contains(key) && CosmeticItem.item(key)?.slot == slot) else {
            workspace.error = "只能穿戴已拥有、与此位置匹配的装扮。"; return
        }
        let session = store.sessionRevision
        guard let response = await workspace.mutate(store, path: "/api/profile/extras", body: ["action": "equip", "slot": slot, "itemKey": key, "requestKey": UUID().uuidString]), owner == store.user?.id, session == store.sessionRevision else { return }
        workspace.data = response
        store.equipmentRevision += 1
        store.user?.cosmetics = cosmetics
        workspace.notice = key.isEmpty ? "已卸下装扮。" : "已穿戴“\(CosmeticItem.item(key)?.title ?? key)”。"
    }
}
