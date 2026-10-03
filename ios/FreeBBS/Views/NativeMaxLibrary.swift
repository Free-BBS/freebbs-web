import SwiftUI

struct MaxDialogSelection: Identifiable { var id: String; var messages: [ChatMessage] }
struct NativeMaxLibrary: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let selected: (MaxDialogSelection) -> Void
    @State private var state = NativeWorkspace()
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            ForEach(Array(state.data["dialogs"].list.enumerated()), id: \.offset) { _, dialog in
                Button { Task { await open(dialog["did"].text) } } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(dialog["title"].text).font(.headline)
                        Text(AppDates.short(dialog["updatedAt"].text)).font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 6)
                }.buttonStyle(.plain)
            }
        }.navigationTitle("对话记录").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } } }
        .task(id: store.sessionRevision) { await state.load(store, path: "/api/ai/dialogs", query: [.init(name: "limit", value: "30")]) }
    }
    private func open(_ id: String) async {
        do {
            let session = store.sessionRevision
            let response: SiteRecord = try await store.api.request("/api/ai/dialogs/" + NativeRoutes.component(id))
            guard session == store.sessionRevision else { return }
            let messages = response["dialog"]["messages"].list.map { record in
                var message = ChatMessage(role: record["role"].text, content: record["content"].text)
                message.metadata = record.fields.filter { !["role", "content"].contains($0.key) }; return message
            }
            selected(.init(id: id, messages: messages)); dismiss()
        } catch { state.error = error.localizedDescription }
    }
}

struct NativeMaxModels: View {
    @Environment(AppStore.self) private var store
    @Binding var model: String
    @Binding var effort: String
    @State private var state = NativeWorkspace()
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            Section("模型") {
                ForEach(Array(state.data["models"].list.enumerated()), id: \.offset) { _, profile in
                    Button { model = profile["id"].text; effort = profile["defaultEffort"].text; save() } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(profile["label"].text).foregroundStyle(.primary)
                                if profile["vision"].flag { Label("支持图片", systemImage: "photo").font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer(); if model == profile["id"].text { Image(systemName: "checkmark").foregroundStyle(Palette.teal) }
                        }.frame(minHeight: 44)
                    }
                }
            }
            if let current = state.data["models"].list.first(where: { $0["id"].text == model }) {
                Section { Picker("思考强度", selection: $effort) { ForEach(current["efforts"].list.map(\.text), id: \.self) { Text($0).tag($0) } } }
            }
        }.navigationTitle("模型与思考").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) {
            await state.load(store, path: "/api/ai/models")
            if model.isEmpty { model = state.data["defaultModel"].text; effort = state.data["models"].list.first { $0["id"].text == model }?["defaultEffort"].text ?? "auto" }
        }.onChange(of: effort) { _, _ in save() }
    }
    private func save() {
        let raw = try? JSONSerialization.data(withJSONObject: ["model": model, "reasoning_effort": effort])
        store.saveWebPreference("free_bbs_max_model_v1:" + (store.user?.uid.isEmpty == false ? store.user!.uid : "local"), value: raw.flatMap { String(data: $0, encoding: .utf8) })
    }
}
