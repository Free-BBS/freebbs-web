import Foundation
import Observation

@MainActor @Observable final class NativeMaxTask {
    nonisolated deinit {}
    var record: SiteRecord = .null
    var progress = "Max 正在后台思考…"
    private func key(_ store: AppStore) -> String { "free_bbs_max_background_task_v1:" + (store.user?.uid.isEmpty == false ? store.user!.uid : "user") }
    func start(_ store: AppStore, dialog: String, payload: [String: Any]) async throws -> SiteRecord {
        let owner = store.sessionRevision
        let response: SiteRecord = try await store.api.request("/api/ai/tasks", method: "POST", body: ["kind": "max", "scopeId": dialog, "payload": payload])
        guard owner == store.sessionRevision else { throw CancellationError() }
        record = response["task"]
        guard record["kind"].text == "max", record["scopeId"].text == dialog, !record["id"].text.isEmpty else { throw APIError.invalidResponse }
        store.saveWebPreference(key(store), value: record["id"].text)
        return try await wait(store)
    }
    func restore(_ store: AppStore) async {
        record = .null
        guard store.user != nil, !store.isDemo, let id = store.webPreferenceValues[key(store)], !id.isEmpty else { return }
        let owner = store.sessionRevision
        if let result: SiteRecord = try? await store.api.request("/api/ai/tasks/" + NativeRoutes.component(id), query: [.init(name: "watching", value: "0")]), owner == store.sessionRevision, result["task"]["kind"].text == "max" { record = result["task"] }
    }
    func wait(_ store: AppStore) async throws -> SiteRecord {
        let owner = store.sessionRevision; let id = record["id"].text
        guard !id.isEmpty else { throw APIError.invalidResponse }
        while ["queued", "running"].contains(record["status"].text) {
            progress = record["progress"]["message"].text.isEmpty ? "Max 正在后台思考，离开页面也会继续…" : record["progress"]["message"].text
            try await Task.sleep(for: .milliseconds(1500)); try Task.checkCancellation()
            guard owner == store.sessionRevision else { throw CancellationError() }
            let response: SiteRecord = try await store.api.request("/api/ai/tasks/" + NativeRoutes.component(id), query: [.init(name: "watching", value: "1")])
            guard owner == store.sessionRevision else { throw CancellationError() }
            record = response["task"]
        }
        guard record["status"].text == "completed", record["result"] != .null else { throw APIError.server(409, record["error"].text.isEmpty ? "后台任务尚未完成。" : record["error"].text) }
        return record["result"]
    }
    func acknowledge(_ store: AppStore) async {
        let owner = store.sessionRevision; let id = record["id"].text
        if !id.isEmpty { let _: SiteRecord? = try? await store.api.request("/api/ai/tasks/" + NativeRoutes.component(id) + "/acknowledge", method: "POST") }
        if owner == store.sessionRevision { store.saveWebPreference(key(store), value: nil); record = .null }
    }
    func leave(_ store: AppStore) {
        let owner = store.sessionRevision; let id = record["id"].text
        guard !id.isEmpty else { return }
        Task { guard owner == store.sessionRevision else { return }; let _: SiteRecord? = try? await store.api.request("/api/ai/tasks/" + NativeRoutes.component(id) + "/presence", method: "POST", body: ["watching": false]) }
    }
    func cancel(_ store: AppStore) async {
        let owner = store.sessionRevision; let id = record["id"].text
        guard !id.isEmpty else { return }
        let _: SiteRecord? = try? await store.api.request("/api/ai/tasks/" + NativeRoutes.component(id) + "/cancel", method: "POST")
        if owner == store.sessionRevision { store.saveWebPreference(key(store), value: nil); record = .null }
    }
}
