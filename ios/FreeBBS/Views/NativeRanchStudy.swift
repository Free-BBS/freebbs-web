import SwiftUI

struct NativeRanchStudy: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var clock = true
    @State private var focus = false
    @State private var minutes = 25
    @State private var remaining: TimeInterval = 25 * 60
    @State private var deadline: Date?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                    VStack(spacing: 16) {
                        if clock { Text(context.date, style: .time).font(.system(size: 30, weight: .light)).monospacedDigit() }
                        NativeSheep().frame(width: 140, height: 148)
                        if focus {
                            let value = max(0, Int(ceil(deadline.map { $0.timeIntervalSince(context.date) } ?? remaining)))
                            Text(String(format: "%02d:%02d", value / 60, value % 60)).font(.system(size: 44, weight: .light)).monospacedDigit().accessibilityLabel("专注剩余 \(value / 60) 分 \(value % 60) 秒")
                            if value == 0 { Text("专注结束，休息一下。") }
                        }
                    }.frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                }
                Section("显示") {
                    Toggle("显示时钟", isOn: $clock)
                    Toggle("专注计时", isOn: $focus)
                }
                if focus {
                    Section("专注") {
                        Picker("专注时长", selection: $minutes) { ForEach([15, 25, 45, 60], id: \.self) { Text("\($0) 分钟").tag($0) } }
                        HStack {
                            Button(deadline == nil ? "开始" : "暂停", systemImage: deadline == nil ? "play.fill" : "pause.fill") { if let deadline { remaining = max(0, deadline.timeIntervalSinceNow); self.deadline = nil } else { if remaining <= 0 { remaining = Double(minutes * 60) }; deadline = .now.addingTimeInterval(remaining) } }.frame(minHeight: 44)
                            Spacer(); Button("重置") { deadline = nil; remaining = Double(minutes * 60) }.frame(minHeight: 44)
                        }.buttonStyle(.borderless)
                    }
                }
            }.background(Color(.systemGroupedBackground))
            .navigationTitle("牧场学习").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } } }
        }
        .task(id: store.sessionRevision) { deadline = nil; let raw = store.webPreferenceValues["freebbs_ranch_study"]; if let data = raw?.data(using: .utf8), let value = try? JSONDecoder().decode(SiteRecord.self, from: data) { clock = value["clock"].flag; focus = value["focus"].flag; minutes = [15, 25, 45, 60].contains(value["minutes"].int) ? value["minutes"].int : 25 }; remaining = Double(minutes * 60) }
        .onChange(of: minutes) { _, _ in deadline = nil; remaining = Double(minutes * 60); save() }
        .onChange(of: clock) { _, _ in save() }.onChange(of: focus) { _, _ in save() }
    }
    private func save() { if let data = try? JSONSerialization.data(withJSONObject: ["clock": clock, "focus": focus, "minutes": minutes]), let raw = String(data: data, encoding: .utf8) { store.saveWebPreference("freebbs_ranch_study", value: raw) } }
}
