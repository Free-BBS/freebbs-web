import SwiftUI

struct CircuitSummary: Decodable, Identifiable {
    let cid: String; let title: String; let description: String; let revision: Int
    var id: String { cid }
}
struct CircuitLibrary: Decodable { let circuits: [CircuitSummary]; let hasMore: Bool }
struct NativeCircuitLibraryView: View {
    @Environment(AppStore.self) private var store
    @State private var circuits: [CircuitSummary] = []
    @State private var error: String?
    @State private var busy = false
    @State private var more = false
    var body: some View {
        List {
            Section {
                NavigationLink { CircuitWorkspaceView(destination: .init(title: "电路编辑", path: "/circuit")) } label: { Label("新建电路", systemImage: "plus.circle") }
                NavigationLink { CircuitWorkspaceView(destination: .init(title: "电路挑战", path: "/circuit-challenge")) } label: { Label("电路挑战", systemImage: "bolt.badge.clock") }
            }
            Section("我的电路") {
                if store.api.token == nil && !store.isDemo { Button("登录以查看电路") { store.showLogin = true } }
                else if circuits.isEmpty && !busy && error == nil { Text("新建电路，保存你的第一个实验。").foregroundStyle(.secondary) }
                if let error { Text(error).foregroundStyle(.red); Button("重试") { Task { await load() } } }
                ForEach(circuits) { circuit in
                    NavigationLink { CircuitWorkspaceView(destination: .init(title: circuit.title, path: "/circuit?cid=\(circuit.cid)&revision=\(circuit.revision)")) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(circuit.title).font(.headline)
                            if !circuit.description.isEmpty { Text(circuit.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
                            Text("版本 \(circuit.revision)").font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 6)
                    }
                }
                if busy { ProgressView() }
                if more { Button("加载更多") { Task { await load(append: true) } }.disabled(busy) }
            }
        }.listStyle(.insetGrouped).navigationTitle("电路实验室")
            .task(id: store.sessionRevision) { await load() }
            .refreshable { await load() }
    }
    private func load(append: Bool = false) async {
        if store.isDemo || store.api.token == nil { circuits = []; more = false; return }
        busy = true; error = nil; defer { busy = false }
        do { let response: CircuitLibrary = try await store.api.request("/api/circuits", query: [.init(name: "mine", value: "1"), .init(name: "limit", value: "30"), .init(name: "offset", value: String(append ? circuits.count : 0))]); circuits = append ? circuits + response.circuits : response.circuits; more = response.hasMore }
        catch { self.error = error.localizedDescription }
    }
}
