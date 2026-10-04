import SwiftUI

struct CheckInView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let state: CheckInState
    @State private var monthOffset = 0
    @State private var selectedDay: String?
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian); value.timeZone = TimeZone(identifier: "Asia/Shanghai")!; value.firstWeekday = 2
        return value
    }
    private func date(_ key: String) -> Date? {
        let f = DateFormatter(); f.calendar = calendar; f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = calendar.timeZone; f.dateFormat = "yyyy-MM-dd"; f.isLenient = false; return f.date(from: key)
    }
    var body: some View {
        List {
            if store.isDemo { Text("示例签到记录 · 不会领取线上奖励").font(.footnote).foregroundStyle(.secondary) }
            if state.loading { ProgressView("正在同步签到状态…") }
            if let error = state.error {
                Section { Text(error).foregroundStyle(.red); Button("重新加载") { Task { await state.load(store) } } }
            }
            if let summary = state.summary {
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(CheckInSummary.fortune(summary.todayFortune.score)).font(.largeTitle.weight(.semibold))
                            Text("今日运势 \(summary.todayFortune.score)").foregroundStyle(.secondary)
                            Text(summary.day + " · 北京时间").font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: summary.checkedInToday ? "checkmark.seal.fill" : "calendar.badge.checkmark").font(.largeTitle).foregroundStyle(Palette.teal)
                    }
                    if let today = summary.today {
                        Text("连续签到 \(today.streak) 天 · 已领取 \(today.reward)")
                    }
                    Button {
                        Task { await state.submit(store) }
                    } label: {
                        HStack { Spacer(); Text(state.busy ? "正在签到…" : summary.checkedInToday ? "今日已签到" : "签到领取奖励"); Spacer() }
                    }.buttonStyle(.borderedProminent)
                        .disabled(summary.checkedInToday || state.loading || state.busy || store.isDemo).accessibilityIdentifier("submitCheckIn")
                    if let notice = state.notice { Text(notice).font(.footnote).foregroundStyle(Palette.teal) }
                }
                Section("签到日历") {
                    monthCalendar(summary)
                    if let selectedDay {
                        if let day = summary.records.first(where: { $0.date == selectedDay }) {
                            Text("\(day.date) · \(CheckInSummary.fortune(day.fortuneScore)) · 连续 \(day.streak) 天 · \(day.reward)")
                        } else { Text(selectedDay + (selectedDay > summary.day ? " · 尚未到来" : " · 未签到")) }
                    }
                }
                Section("最近签到记录") {
                    if summary.records.isEmpty { Text("暂无签到记录").foregroundStyle(.secondary) }
                    ForEach(summary.records) { day in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) { Text(day.date); Text("连续 \(day.streak) 天 · \(CheckInSummary.fortune(day.fortuneScore))").font(.caption).foregroundStyle(.secondary) }
                            Spacer(); Text(day.reward).foregroundStyle(Palette.teal)
                        }
                    }
                }
            }
        }.navigationTitle("签到").navigationBarTitleDisplayMode(.inline).tint(Palette.teal)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } } }
            .refreshable { await state.load(store) }
            .task { await state.load(store) }
            .onChange(of: state.summary?.day, initial: true) { _, day in monthOffset = 0; selectedDay = day }
            .onChange(of: store.user?.id) { _, _ in monthOffset = 0; selectedDay = nil }
    }
    @ViewBuilder private func monthCalendar(_ summary: CheckInSummary) -> some View {
        if let current = date(summary.day), let month = calendar.date(byAdding: .month, value: monthOffset, to: calendar.date(from: calendar.dateComponents([.year, .month], from: current))!),
           let range = calendar.range(of: .day, in: .month, for: month) {
            let blanks = (calendar.component(.weekday, from: month) + 5) % 7
            let checked = Dictionary(summary.records.map { ($0.date, $0) }, uniquingKeysWith: { _, latest in latest })
            let oldestDate = calendar.date(byAdding: .day, value: -365, to: current)!
            let oldestMonthStart = calendar.date(from: calendar.dateComponents([.year, .month], from: oldestDate))!
            let oldestMonth = calendar.component(.day, from: oldestDate) == 1 ? oldestMonthStart : calendar.date(byAdding: .month, value: 1, to: oldestMonthStart)!
            VStack(spacing: 8) {
                HStack {
                    Button { monthOffset -= 1; selectedDay = nil } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.disabled(month <= oldestMonth).accessibilityLabel("上个月")
                    Spacer(); Text("\(String(calendar.component(.year, from: month))) 年 \(calendar.component(.month, from: month)) 月").font(.headline); Spacer()
                    Button { monthOffset += 1; selectedDay = nil } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }.disabled(monthOffset >= 0).accessibilityLabel("下个月")
                }.buttonStyle(.borderless)
                Text("本月已签到 \(checked.keys.filter { $0.hasPrefix(String(CheckInSummary.beijingDay(month).prefix(7))) }.count) 天 · 灰色为未签到").font(.caption).foregroundStyle(.secondary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 4) {
                    ForEach(Array(["一", "二", "三", "四", "五", "六", "日"].enumerated()), id: \.offset) { _, name in Text(name).font(.caption).foregroundStyle(.secondary) }
                    ForEach(0..<(blanks + range.count), id: \.self) { index in
                        if index < blanks { Color.clear.frame(height: 44) }
                        else {
                            let day = calendar.date(byAdding: .day, value: index - blanks, to: month)!
                            let key = CheckInSummary.beijingDay(day)
                            let record = checked[key]
                            let tint = fortuneColor(record?.fortuneScore)
                            Button { selectedDay = key } label: {
                                Text("\(index - blanks + 1)").font(.subheadline).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6).frame(maxWidth: .infinity, minHeight: 44)
                                    .foregroundStyle(tint)
                                    .background(record != nil ? tint.opacity(0.12) : Color.clear, in: Circle())
                                    .overlay { if key == summary.day { Circle().strokeBorder(Palette.teal, lineWidth: 1) } }
                            }.buttonStyle(.plain).accessibilityLabel(key + (record.map { " 已签到 · \(CheckInSummary.fortune($0.fortuneScore)) · \($0.reward)" } ?? " 未签到"))
                        }
                    }
                }
            }.accessibilityElement(children: .contain).accessibilityIdentifier("checkInCalendar")
        }
    }
    private func fortuneColor(_ score: Int?) -> Color {
        guard let score else { return .secondary }
        return score >= 90 ? .orange : score >= 70 ? Palette.teal : score >= 50 ? .blue : score >= 20 ? .indigo : .secondary
    }
}
