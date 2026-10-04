import SwiftUI

struct ContributionHeatmap: View {
    let activity: ContributionActivity
    @State private var selectedDate: Date
    init(activity: ContributionActivity) {
        self.activity = activity
        _selectedDate = State(initialValue: activity.days.last!.date)
    }
    private let step: CGFloat = 16
    private var selected: ContributionActivity.Day? { activity.day(selectedDate) }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("近一年 \(activity.total) 次活动").font(.headline)
            HStack(alignment: .top, spacing: 6) {
                VStack(spacing: 0) {
                    Color.clear.frame(height: 22)
                    ForEach(Array(["一", "", "三", "", "五", "", ""].enumerated()), id: \.offset) { _, day in
                        Text(day).font(.caption2).foregroundStyle(.secondary).frame(width: 12, height: step)
                    }
                }.accessibilityHidden(true)
                ScrollView(.horizontal) {
                Canvas { context, _ in
                    var month = ""
                    for day in activity.days.indices {
                        let value = activity.days[day], index = day + activity.offset
                        let x = CGFloat(index / 7) * step, y = CGFloat(index % 7) * step + 22
                        let current = String(value.key.prefix(7))
                        if month != current {
                            if day > 0 || ContributionActivity.calendar.component(.day, from: value.date) <= 21 {
                                context.draw(Text("\(ContributionActivity.calendar.component(.month, from: value.date))月").font(.caption2).foregroundColor(.secondary), at: CGPoint(x: x, y: 8), anchor: .leading)
                            }
                            month = current
                        }
                        let rect = CGRect(x: x, y: y, width: 12, height: 12)
                        context.fill(Path(roundedRect: rect, cornerRadius: 3), with: .color(color(value.level)))
                        if selected?.key == value.key { context.stroke(Path(roundedRect: rect.insetBy(dx: -1, dy: -1), cornerRadius: 3), with: .color(.primary), lineWidth: 1.5) }
                    }
                }.frame(width: CGFloat(activity.weeks) * step, height: step * 7 + 22)
                    .contentShape(Rectangle())
                    .gesture(SpatialTapGesture().onEnded { event in
                        let row = Int((event.location.y - 22) / step), column = Int(event.location.x / step)
                        let index = column * 7 + row - activity.offset
                        if event.location.y >= 22, (0..<7).contains(row), activity.days.indices.contains(index) { selectedDate = activity.days[index].date }
                    })
                    .accessibilityLabel("近一年贡献热力图，\(activity.total) 次活动")
                    .accessibilityValue(selected?.detail ?? "请使用下方日期控件查看每日活动")
                }.defaultScrollAnchor(.trailing).accessibilityIdentifier("contributionHeatmap")
            }
            HStack(spacing: 5) {
                Text("少").font(.caption)
                ForEach(0..<5, id: \.self) { level in RoundedRectangle(cornerRadius: 3).fill(color(level)).frame(width: 14, height: 14) }
                Text("多").font(.caption)
                Spacer()
            }.accessibilityElement(children: .ignore).accessibilityLabel("颜色越深，活动越多")
            DatePicker("查看日期", selection: $selectedDate, in: activity.days.first!.date...activity.days.last!.date, displayedComponents: .date)
                .environment(\.calendar, ContributionActivity.calendar).environment(\.timeZone, ContributionActivity.calendar.timeZone)
                .accessibilityIdentifier("contributionDatePicker")
            if let selected { Text(selected.detail).font(.footnote).foregroundStyle(.secondary) }
            Text(activity.visibility == "members" ? "签到、可见发帖与实名评论 · 北京时间" : "签到、游客可见发帖与实名评论 · 北京时间")
                .font(.caption).foregroundStyle(.secondary)
        }.onAppear { if activity.day(selectedDate) == nil { selectedDate = activity.days.last!.date } }
            .onChange(of: activity.days.last!.key) { _, _ in if activity.day(selectedDate) == nil { selectedDate = activity.days.last!.date } }
    }
    private func color(_ level: Int) -> Color { level == 0 ? Color(uiColor: .systemGray5) : Palette.teal.opacity([0.0, 0.25, 0.45, 0.7, 1][level]) }
}
