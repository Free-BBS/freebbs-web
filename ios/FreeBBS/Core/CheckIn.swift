import Foundation
import Observation

struct CheckInDay: Decodable, Identifiable, Equatable {
    let date: String
    let streak: Int
    let rewardElectrons: Int
    let rewardMagnetic: Int
    let fortuneScore: Int
    var id: String { date }
    var reward: String {
        var items: [String] = []
        if rewardMagnetic > 0 { items.append("\(rewardMagnetic) 磁元") }
        if rewardElectrons > 0 { items.append("\(rewardElectrons) 电元") }
        return items.isEmpty ? "无奖励" : items.joined(separator: "、")
    }
}
struct CheckInSummary: Decodable {
    struct Fortune: Decodable { let date: String; let score: Int }
    let checkedInToday: Bool
    let today: CheckInDay?
    let todayFortune: Fortune
    let records: [CheckInDay]
    var day: String { todayFortune.date }
    static func beijingDay(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        formatter.dateFormat = "yyyy-MM-dd"; return formatter.string(from: date)
    }
    static func fortune(_ score: Int) -> String {
        score >= 90 ? "祥瑞" : score >= 70 ? "大吉" : score >= 50 ? "吉" : score >= 20 ? "顺" : "平"
    }
    static var preview: Self {
        let day = beijingDay(.now)
        let record = CheckInDay(date: day, streak: 3, rewardElectrons: 0, rewardMagnetic: 4, fortuneScore: 81)
        return Self(checkedInToday: true, today: record, todayFortune: .init(date: day, score: 81), records: [record])
    }
}
struct CheckInResponse: Decodable {
    let user: User?
    let alreadyCheckedIn: Bool
    let summary: CheckInSummary
    enum CodingKeys: String, CodingKey { case user, alreadyCheckedIn, summary }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        user = try container.decodeIfPresent(User.self, forKey: .user)
        alreadyCheckedIn = try container.decodeIfPresent(Bool.self, forKey: .alreadyCheckedIn) ?? false
        // GET returns the summary at the root; POST returns it under summary.
        summary = try container.decodeIfPresent(CheckInSummary.self, forKey: .summary) ?? CheckInSummary(from: decoder)
    }
}

@MainActor @Observable final class CheckInState {
    nonisolated deinit {}
    var summary: CheckInSummary?
    var loading = false
    var busy = false
    var error: String?
    var notice: String?
    private var revision = 0
    private var account: Int?
    func needsDayRefresh(_ now: Date) -> Bool { summary?.day != CheckInSummary.beijingDay(now) }
    func load(_ store: AppStore) async {
        let owner = store.user?.id
        if account != owner { revision += 1; summary = nil; notice = nil; error = nil; busy = false; loading = false; account = owner }
        guard !busy else { return }
        revision += 1; let request = revision, session = store.sessionRevision
        error = nil
        guard owner != nil else { summary = nil; loading = false; return }
        guard !store.isDemo else { summary = .preview; loading = false; return }
        loading = true
        defer { if revision == request { loading = false } }
        do {
            let response: CheckInResponse = try await store.api.request("/api/checkin")
            guard !Task.isCancelled, revision == request, session == store.sessionRevision, owner == store.user?.id else { return }
            accept(response, store: store)
        } catch {
            if revision == request, session == store.sessionRevision, owner == store.user?.id, !Task.isCancelled { self.error = error.localizedDescription }
        }
    }
    func submit(_ store: AppStore) async {
        guard !busy, !loading, store.requireLogin(), !store.isDemo else { return }
        if needsDayRefresh(.now) { await load(store) }
        guard summary?.checkedInToday == false, summary?.day == CheckInSummary.beijingDay(.now), !loading, !busy else { return }
        revision += 1; let request = revision, session = store.sessionRevision, owner = store.user?.id
        busy = true; error = nil; notice = nil
        defer { if revision == request { busy = false } }
        do {
            let response: CheckInResponse = try await store.api.request("/api/checkin", method: "POST", body: [:])
            guard revision == request, session == store.sessionRevision, owner == store.user?.id else { return }
            accept(response, store: store)
            notice = response.alreadyCheckedIn ? "今日已经签到，无需重复领取。" : "签到成功 · \(response.summary.today?.reward ?? "请查看签到记录")"
        } catch {
            if revision == request, session == store.sessionRevision, owner == store.user?.id { self.error = error.localizedDescription }
        }
    }
    private func accept(_ response: CheckInResponse, store: AppStore) {
        summary = response.summary
        if let user = response.user, user.id == store.user?.id { store.user = user }
    }
}
