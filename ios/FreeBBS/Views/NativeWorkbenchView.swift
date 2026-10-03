import SwiftUI

struct NativeWorkbenchView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var important = NativeWorkspace()
    @State private var date = Date.now
    @State private var editor: WorkbenchEdit?
    @State private var closed = false
    @State private var weekView = false
    private var from: Date { Calendar.current.startOfDay(for: date) }
    var body: some View {
        Group {
            if store.user == nil { NativeAccountRequired(title: "登录后查看工作台") }
            else { List {
                Section {
                    DatePicker("查看日期", selection: $date, displayedComponents: .date)
                    Toggle("显示已完成事项", isOn: $closed)
                    Toggle("七天视图", isOn: $weekView)
                }
                WorkspaceStatus(state: state)
                if weekView { Section("一周安排") { weekGrid } }
                Section("日程") {
                    if state.data["scheduleItems"].list.isEmpty && !state.loading { Text("本周暂无安排").foregroundStyle(.secondary) }
                    ForEach(Array(state.data["scheduleItems"].list.enumerated()), id: \.offset) { _, item in
                        Button { editor = .init(kind: .schedule, record: item) } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack { Text(item["title"].text).font(.headline); Spacer(); if item["status"].text == "draft" { Text("待确认").font(.caption).foregroundStyle(.orange) } }
                                Label(AppDates.short(item["startAt"].text) + " – " + AppDates.short(item["endAt"].text), systemImage: "clock").font(.subheadline).foregroundStyle(.secondary)
                                if !item["description"].text.isEmpty { Text(item["description"].text).foregroundStyle(.secondary) }
                            }.padding(.vertical, 5)
                        }.buttonStyle(.plain)
                        .swipeActions {
                            if !item["homeworkReference"].text.isEmpty { Button(item["completed"].flag ? "未完成" : "已完成") { Task { if await important.mutate(store, path: "/api/workbench/homework-deadlines/" + NativeRoutes.component(item["homeworkReference"].text) + "/completion", method: "PATCH", body: ["completed": !item["completed"].flag]) != nil { await load() } } }.tint(.green) }
                            if item["status"].text == "draft" { Button("确认") { Task { await act(item, kind: "schedule-items", action: "confirm") } }.tint(.green) }
                        }
                    }
                }
                WorkspaceStatus(state: important)
                Section("重要事项") {
                    ForEach(Array(important.data["importantItems"].list.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .top) {
                            Button { Task { await act(item, kind: "important-items", action: item["status"].text == "completed" ? "confirmed" : "completed") } } label: {
                                Image(systemName: item["status"].text == "completed" ? "checkmark.circle.fill" : "circle").frame(width: 44, height: 44)
                            }.buttonStyle(.borderless).accessibilityLabel("切换事项完成状态")
                            Button { editor = .init(kind: .important, record: item) } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(item["title"].text).font(.headline)
                                    if !item["dueAt"].text.isEmpty { Text("截止 " + AppDates.short(item["dueAt"].text)).font(.caption).foregroundStyle(.secondary) }
                                    if !item["description"].text.isEmpty { Text(item["description"].text).font(.subheadline).foregroundStyle(.secondary) }
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 5)
                            }.buttonStyle(.borderless)
                        }
                    }
                    Button("添加重要事项", systemImage: "plus") { editor = .init(kind: .important, record: .empty) }.accessibilityIdentifier("addImportant")
                }
                Section("计划与通知") {
                    NavigationLink { NativeSchedulePlanner() } label: { Label("与 Max 规划", systemImage: "sparkles") }
                    NavigationLink("校园课程与作业") { NativeCampusView() }
                    NavigationLink { InboxView() } label: { Label("通知中心", systemImage: "bell") }
                }
            }.refreshable { await load() } }
        }.navigationTitle("我的工作台").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Button("添加日程", systemImage: "plus.circle.fill") { if store.requireLogin() { editor = .init(kind: .schedule, record: .empty) } }.accessibilityIdentifier("addSchedule")
        } }
        .task(id: store.sessionRevision) { await load() }
        .onChange(of: date) { _, _ in Task { await load() } }
        .onChange(of: closed) { _, _ in Task { await load() } }
        .sheet(item: $editor) { item in NavigationStack { WorkbenchEditor(edit: item) { Task { await load() } } }.environment(store) }
    }
    private var weekGrid: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(0..<7, id: \.self) { offset in
                    let day = Calendar.current.date(byAdding: .day, value: offset, to: from) ?? from
                    VStack(alignment: .leading, spacing: 10) {
                        Text(day, format: .dateTime.weekday(.abbreviated).month().day()).font(.subheadline.bold())
                        ForEach(Array(state.data["scheduleItems"].list.filter { item in guard let date = AppDates.parse(item["startAt"].text) else { return false }; return Calendar.current.isDate(date, inSameDayAs: day) }.enumerated()), id: \.offset) { _, item in
                            Button { editor = .init(kind: .schedule, record: item) } label: {
                                VStack(alignment: .leading, spacing: 5) { Text(item["title"].text).font(.subheadline.weight(.medium)); if let date = AppDates.parse(item["startAt"].text) { Text(date, style: .time).font(.caption).monospacedDigit() } }
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(10).background(Palette.teal.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                            }.buttonStyle(.plain)
                        }
                    }.frame(width: 140, alignment: .topLeading)
                }
            }.padding(.vertical, 8)
        }.accessibilityIdentifier("nativeWeekCalendar")
    }
    private func load() async {
        guard store.user != nil else { return }
        let format = ISO8601DateFormatter()
        async let schedule: Void = state.load(store, path: "/api/workbench/schedule-items", query: [.init(name: "from", value: format.string(from: from)), .init(name: "to", value: format.string(from: from.addingTimeInterval(7 * 86400)))])
        async let tasks: Void = important.load(store, path: "/api/workbench/important-items", query: [.init(name: "includeClosed", value: String(closed))])
        _ = await (schedule, tasks)
    }
    private func act(_ item: SiteRecord, kind: String, action: String) async {
        let path = "/api/workbench/" + kind + "/" + NativeRoutes.component(item["publicId"].text)
        let result = await important.mutate(store, path: action == "confirm" ? path + "/confirm" : path, method: action == "confirm" ? "POST" : "PATCH", body: action == "confirm" ? [:] : ["status": action])
        if result != nil { await load() }
    }
}

struct WorkbenchEdit: Identifiable {
    enum Kind { case schedule, important }
    let id = UUID(); let kind: Kind; let record: SiteRecord
}
struct WorkbenchEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let edit: WorkbenchEdit
    let saved: () -> Void
    @State private var state = NativeWorkspace()
    @State private var title = ""
    @State private var notes = ""
    @State private var start = Date.now
    @State private var end = Date.now.addingTimeInterval(3600)
    @State private var due = false
    @State private var allDay = false
    @State private var priority = "normal"
    @State private var repeats = "none"
    @State private var count = 8
    @State private var confirmDelete = false
    @State private var conflictConfirmed = false
    @State private var series = NativeWorkspace()
    @State private var scope = "this"
    @State private var recurrenceMode = "keep"
    @State private var kind = "event"
    private var existing: Bool { !edit.record["publicId"].text.isEmpty }
    private var base: String { "/api/workbench/" + (edit.kind == .schedule ? "schedule-items" : "important-items") }
    private var path: String { existing ? base + "/" + NativeRoutes.component(edit.record["publicId"].text) : base }
    var body: some View {
        Form {
            Section {
                TextField("标题", text: $title).accessibilityIdentifier("workbenchTitle")
                TextField("说明", text: $notes, axis: .vertical).lineLimit(3...8)
            }
            if edit.kind == .schedule {
                Section("时间") {
                    DatePicker("开始", selection: $start)
                    DatePicker("结束", selection: $end)
                    Toggle("全天", isOn: $allDay)
                    if !existing {
                        Picker("类型", selection: $kind) { Text("普通事件").tag("event"); Text("课程").tag("course"); Text("截止事项").tag("deadline") }
                        Picker("重复", selection: $repeats) { Text("不重复").tag("none"); Text("每天").tag("day"); Text("每周").tag("week") }
                            .disabled(kind == "deadline")
                        if repeats != "none" { Stepper("共 \(count) 次", value: $count, in: 1...52) }
                    }
                }
            } else {
                Section {
                    Picker("优先级", selection: $priority) { Text("低").tag("low"); Text("普通").tag("normal"); Text("高").tag("high"); Text("紧急").tag("urgent") }
                    Toggle("截止时间", isOn: $due)
                    if due { DatePicker("截止", selection: $end) }
                }
            }
            if series.data["series"] != .null {
                Section("重复安排") {
                    Picker("修改范围", selection: $scope) { Text("仅本次").tag("this"); Text("本次及以后").tag("following") }
                    if scope == "following" && !series.data["series"]["imported"].flag {
                        Picker("重复规则", selection: $recurrenceMode) { Text("保持规则").tag("keep"); Text("替换规则").tag("replace") }
                        if recurrenceMode == "replace" { Picker("间隔", selection: $repeats) { Text("每天").tag("day"); Text("每周").tag("week") }; Stepper("共 \(count) 次", value: $count, in: 1...52) }
                    }
                }
            }
            WorkspaceStatus(state: state)
            if existing { Section { Button("删除", role: .destructive) { confirmDelete = true } } }
        }.navigationTitle(existing ? "编辑" : (edit.kind == .schedule ? "添加日程" : "添加事项"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button(conflictConfirmed ? "仍然保存" : "保存") { Task { await save() } }.disabled(state.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 200 || notes.count > 4000 || (edit.kind == .schedule && end <= start)).accessibilityIdentifier("saveWorkbench") }
        }
        .onAppear {
            title = edit.record["title"].text; notes = edit.record["description"].text
            start = AppDates.parse(edit.record["startAt"].text) ?? .now
            end = AppDates.parse(edit.record[edit.kind == .schedule ? "endAt" : "dueAt"].text) ?? start.addingTimeInterval(3600)
            due = !edit.record["dueAt"].text.isEmpty; allDay = edit.record["allDay"].flag
            kind = edit.record["kind"].text.isEmpty ? "event" : edit.record["kind"].text
            if !edit.record["priority"].text.isEmpty { priority = edit.record["priority"].text }
        }
        .task { if existing && edit.kind == .schedule { await series.load(store, path: path + "/series"); if series.data["series"] != .null { repeats = series.data["series"]["recurrence"]["unit"].text.isEmpty ? "week" : series.data["series"]["recurrence"]["unit"].text } } }
        .onChange(of: kind) { _, value in if value == "course" && repeats == "none" { repeats = "week" }; if value == "deadline" { repeats = "none"; allDay = false } }
        .onChange(of: start) { _, _ in conflictConfirmed = false }.onChange(of: end) { _, _ in conflictConfirmed = false }
        .confirmationDialog("删除这项安排？", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("删除", role: .destructive) { Task { if await state.mutate(store, path: series.data["series"] == .null ? path : path + "/series", method: series.data["series"] == .null ? "DELETE" : "POST", body: series.data["series"] == .null ? [:] : ["operation": "delete", "scope": scope, "version": series.data["series"]["version"].int, "fingerprint": series.data["series"]["fingerprint"].text]) != nil { saved(); dismiss() } } }
        }
    }
    private func save() async {
        let format = ISO8601DateFormatter()
        var body: [String: Any] = ["title": title, "description": notes]
        var target = path
        var method = existing ? "PATCH" : "POST"
        if edit.kind == .schedule {
            body.merge(["startAt": format.string(from: start), "endAt": format.string(from: end), "allDay": allDay, "timezone": TimeZone.current.identifier]) { _, new in new }
            if existing { body["version"] = edit.record["version"].int; if !edit.record["sourceRevision"].text.isEmpty { body["sourceRevision"] = edit.record["sourceRevision"].text } }
            else { body["kind"] = kind }
            if kind == "deadline" { body["startAt"] = format.string(from: end.addingTimeInterval(-60)); body["allDay"] = false }
            if !existing && repeats != "none" {
                target = kind == "course" ? "/api/workbench/manual-courses" : "/api/workbench/recurring-events"; body["recurrence"] = ["unit": repeats, "interval": 1, "count": count]; body["allowConflicts"] = conflictConfirmed
            } else if !conflictConfirmed && !store.isDemo {
                do {
                    var query = [URLQueryItem(name: "startAt", value: format.string(from: start)), .init(name: "endAt", value: format.string(from: end))]
                    if existing { query.append(.init(name: "excludePublicId", value: edit.record["publicId"].text)) }
                    let result: SiteRecord = try await store.api.request("/api/workbench/schedule-items/conflicts", query: query)
                    if !result["conflicts"].list.isEmpty { state.error = "时间与已有日程冲突，请调整时间或再次确认保存。"; conflictConfirmed = true; return }
                } catch { state.error = error.localizedDescription; return }
            }
        } else { body["priority"] = priority; body["dueAt"] = due ? format.string(from: end) as Any : NSNull() }
        if existing && edit.kind == .schedule && series.data["series"] != .null {
            target = path + "/series"; method = "POST"
            let patch = body.filter { ["title", "description", "startAt", "endAt", "allDay", "timezone"].contains($0.key) }
            body = ["operation": "update", "scope": scope, "version": series.data["series"]["version"].int, "fingerprint": series.data["series"]["fingerprint"].text, "patch": patch, "recurrenceMode": recurrenceMode, "allowConflicts": conflictConfirmed]
            if scope == "following" && recurrenceMode == "replace" { body["recurrence"] = ["unit": repeats, "interval": 1, "count": count] }
        }
        if await state.mutate(store, path: target, method: method, body: body) != nil { saved(); dismiss() }
    }
}
