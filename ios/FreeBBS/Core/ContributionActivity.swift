import Foundation

struct ContributionActivity {
    struct Day: Identifiable, Equatable {
        let date: Date
        let key: String
        let checkins: Int
        let posts: Int
        let comments: Int
        let count: Int
        var id: String { key }
        var level: Int { count == 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4 }
        var detail: String { "\(key) · \(count) 次活动（签到 \(checkins)、发帖 \(posts)、评论 \(comments)）" }
    }
    static var calendar: Calendar {
        var value = Calendar(identifier: .gregorian); value.timeZone = TimeZone(identifier: "Asia/Shanghai")!; return value
    }
    let days: [Day]
    let offset: Int
    let visibility: String
    var total: Int { days.reduce(0) { $0 + $1.count } }
    var weeks: Int { (days.count + offset + 6) / 7 }
    init?(_ record: SiteRecord) {
        guard record["visibility"].text != "private" else { return nil }
        let formatter = DateFormatter(); formatter.calendar = Self.calendar; formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = Self.calendar.timeZone; formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        let endKey = record["end"].text
        guard endKey.count == 10, let end = formatter.date(from: endKey), formatter.string(from: end) == endKey,
              let start = Self.calendar.date(byAdding: .day, value: -364, to: end) else { return nil }
        var records: [String: SiteRecord] = [:]
        for value in record["days"].list { records[value["date"].text] = value }
        days = (0..<365).map { index in
            let date = Self.calendar.date(byAdding: .day, value: index, to: start)!, key = formatter.string(from: date)
            let value = records[key] ?? .empty
            return Day(date: date, key: key, checkins: max(0, value["checkins"].int), posts: max(0, value["posts"].int), comments: max(0, value["comments"].int), count: max(0, value["count"].int))
        }
        offset = (Self.calendar.component(.weekday, from: start) + 5) % 7
        visibility = record["visibility"].text
    }
    func day(_ date: Date) -> Day? { let key = CheckInSummary.beijingDay(date); return days.first { $0.key == key } }
    static var preview: SiteRecord {
        let calendar = Self.calendar
        let days: [SiteRecord] = (0..<90).filter { $0 % 3 != 0 }.map { index in
            let date = calendar.date(byAdding: .day, value: -index, to: .now)!
            let count = index % 11 + 1
            return .object(["date":.string(CheckInSummary.beijingDay(date)),"checkins":.number(1),"posts":.number(Double(count / 3)),"comments":.number(Double(count - 1 - count / 3)),"count":.number(Double(count))])
        }
        return .object(["end":.string(CheckInSummary.beijingDay(.now)),"visibility":.string("members"),"days":.array(days)])
    }
}
