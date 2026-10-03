import SwiftUI

struct NativeSchedulePlanner: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var availability = NativeWorkspace()
    @State private var message = ""
    @State private var selected: Set<Int> = []
    @State private var confirming = false
    @State private var submitted = false
    @State private var days = 7
    private let base = "/api/workbench/schedule-planner"
    private var suggestions: [SiteRecord] { state.data["suggestions"].list }
    var body: some View {
        @Bindable var store = store
        Form {
            Section("个人节奏") {
                NavigationLink("规划偏好") { NativePlanningPreferences() }
                Picker("查看空档", selection: $days) { Text("今天").tag(1); Text("未来七天").tag(7) }
                WorkspaceStatus(state: availability)
                if !availability.loading { Text("可用时间 \(availability.data["minutes"].int) 分钟").font(.subheadline).foregroundStyle(.secondary) }
                ForEach(Array(availability.data["windows"].list.enumerated()), id: \.offset) { _, item in
                    Label(AppDates.short(item["startAt"].text) + " – " + AppDates.short(item["endAt"].text), systemImage: "clock").font(.subheadline)
                }
            }
            Section("告诉 Max 你的安排") {
                TextField("例如：未来三天安排四小时复习，每次一小时", text: $message, axis: .vertical).lineLimit(3...8).accessibilityIdentifier("planningMessage")
                if !store.aiConsent { Toggle("同意使用 Max 并记住我的选择", isOn: $store.aiConsent) }
                Button("生成计划预览", systemImage: "sparkles") { Task { await preview() } }
                    .disabled(!store.aiConsent || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || message.count > 600 || state.busy)
            }
            WorkspaceStatus(state: state)
            if !suggestions.isEmpty {
                Section("选择要添加的日程") {
                    ForEach(Array(suggestions.enumerated()), id: \.offset) { index, item in
                        Toggle(isOn: Binding(get: { selected.contains(index) }, set: { if $0 { selected.insert(index) } else { selected.remove(index) } })) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(item["title"].text).font(.headline)
                                Text(AppDates.short(item["startAt"].text) + " – " + AppDates.short(item["endAt"].text)).font(.caption).foregroundStyle(.secondary)
                                if !item["description"].text.isEmpty { Text(item["description"].text).font(.subheadline) }
                            }
                        }
                    }
                    Button("确认添加 \(selected.count) 项") { confirming = true }.disabled(selected.isEmpty || state.busy || submitted)
                    if submitted { Text("本次确认已发送。请回工作台核对安排，再生成下一份计划。").font(.footnote).foregroundStyle(.secondary) }
                }
            }
        }.navigationTitle("与 Max 规划").navigationBarTitleDisplayMode(.inline)
        .task(id: "\(store.sessionRevision)-\(days)") { await availability.load(store, path: base + "/availability", query: [.init(name: "days", value: String(days))]) }
        .confirmationDialog("将选中的 \(selected.count) 项加入个人日程？", isPresented: $confirming, titleVisibility: .visible) {
            Button("添加到日程") { Task {
                submitted = true
                if await state.mutate(store, path: base + "/confirm", body: ["suggestions": selected.sorted().compactMap { suggestions.indices.contains($0) ? suggestions[$0].value : nil }]) != nil {
                    selected = []; state.notice = "日程已添加。"; await availability.load(store, path: base + "/availability", query: [.init(name: "days", value: String(days))])
                }
            } }
        }
        .onChange(of: store.sessionRevision) { _, _ in message = ""; selected = []; state = NativeWorkspace(); submitted = false }
    }
    private func preview() async {
        guard store.aiConsent else { return }
        if let result = await state.mutate(store, path: base + "/preview", body: ["message": message.trimmingCharacters(in: .whitespacesAndNewlines)]) { state.data = result; selected = Set(suggestions.indices); submitted = false }
    }
}

struct NativePlanningPreferences: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var enabled = true
    @State private var start = "09:00"
    @State private var end = "21:00"
    @State private var weekdays: Set<Int> = Set(1...7)
    @State private var focus = 60
    @State private var pause = 15
    @State private var maximum = 120
    @State private var rests: [PlanningRest] = []
    private let base = "/api/workbench/schedule-planner/preferences"
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            Section("时间范围") {
                Toggle("启用个人偏好", isOn: $enabled)
                TextField("开始时间（HH:mm）", text: $start).keyboardType(.numbersAndPunctuation)
                TextField("结束时间（HH:mm）", text: $end).keyboardType(.numbersAndPunctuation)
                ForEach(Array(["周一", "周二", "周三", "周四", "周五", "周六", "周日"].enumerated()), id: \.offset) { index, title in
                    Toggle(title, isOn: Binding(get: { weekdays.contains(index + 1) }, set: { if $0 { weekdays.insert(index + 1) } else { weekdays.remove(index + 1) } }))
                }
            }
            Section("专注与休息") {
                Picker("每段专注", selection: $focus) { ForEach([30, 45, 60, 90, 120], id: \.self) { Text("\($0) 分钟").tag($0) } }
                Picker("段间休息", selection: $pause) { ForEach([0, 5, 10, 15, 30], id: \.self) { Text("\($0) 分钟").tag($0) } }
                Stepper("每天最多 \(maximum) 分钟", value: $maximum, in: 30...480, step: 15)
                ForEach($rests) { $rest in HStack { TextField("休息开始", text: $rest.start); Text("–"); TextField("休息结束", text: $rest.end) } }
                    .onDelete { rests.remove(atOffsets: $0) }
                Button("添加休息时段", systemImage: "plus") { rests.append(.init(start: "12:00", end: "13:00")) }.disabled(rests.count >= 4)
            }
            Button("保存偏好") { Task {
                if await state.mutate(store, path: base, method: "PUT", body: ["enabled": enabled, "dayStart": start, "dayEnd": end, "weekdays": weekdays.sorted(), "focusMinutes": focus, "breakMinutes": pause, "dailyMaxMinutes": maximum, "restWindows": rests.map { ["start": $0.start, "end": $0.end] }]) != nil { state.notice = "规划偏好已保存。" }
            } }.disabled(state.loading || state.busy || weekdays.isEmpty || !validTime(start) || !validTime(end) || start >= end || rests.contains { !validTime($0.start) || !validTime($0.end) || $0.start >= $0.end })
        }.navigationTitle("规划偏好").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) {
            await state.load(store, path: base)
            let p = state.data["preferences"]
            if p != .null { enabled = p["enabled"].flag; start = p["dayStart"].text; end = p["dayEnd"].text; weekdays = Set(p["weekdays"].list.map(\.int)); focus = p["focusMinutes"].int; pause = p["breakMinutes"].int; maximum = p["dailyMaxMinutes"].int; rests = p["restWindows"].list.map { .init(start: $0["start"].text, end: $0["end"].text) } }
        }
    }
    private func validTime(_ value: String) -> Bool { value.range(of: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) != nil }
}
struct PlanningRest: Identifiable { let id = UUID(); var start: String; var end: String }
