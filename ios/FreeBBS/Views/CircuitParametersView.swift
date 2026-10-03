import SwiftUI
import WebKit

struct CircuitParameter: Decodable, Identifiable {
    struct Option: Decodable, Identifiable { let value: String; let title: String; var id: String { value } }
    let id: String; let label: String; var value: String; let options: [Option]
}
struct CircuitParametersView: View {
    @Environment(\.dismiss) private var dismiss
    let browser: LabBrowserState
    @State private var fields: [CircuitParameter] = []
    @State private var error: String?
    private static let names = [
        "circuit-title":"电路名称", "circuit-description":"说明", "circuit-analysis-type":"分析类型",
        "circuit-transient-stop":"终止时间", "circuit-transient-step":"时间步长", "circuit-transient-initial":"初始状态",
        "circuit-sweep-component":"扫描元件", "circuit-sweep-parameter":"扫描参数", "circuit-sweep-start":"扫描起点",
        "circuit-sweep-stop":"扫描终点", "circuit-sweep-points":"扫描点数", "circuit-ac-start":"起始频率",
        "circuit-ac-stop":"终止频率", "circuit-ac-points":"频率点数", "circuit-ac-scale":"频率间隔"
    ]
    var body: some View {
        Form {
            if let error { Text(error).foregroundStyle(.red) }
            ForEach($fields) { $field in
                if field.options.isEmpty { TextField(field.label, text: $field.value, axis: .vertical).textInputAutocapitalization(.never).autocorrectionDisabled() }
                else { Picker(field.label, selection: $field.value) { ForEach(field.options) { Text($0.title).tag($0.value) } }
                        .onChange(of: field.value) { _, _ in if field.id == "circuit-analysis-type" { Task { await apply(); await read() } } }
                }
            }
        }.navigationTitle("电路参数").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("应用") { Task { await apply(); if error == nil { dismiss() } } } }
            }
            .task { await read() }
    }
    private func read() async {
        guard let web = browser.webView else { return }
        do {
            let result = try await web.callAsyncJavaScript("""
            if (location.pathname !== '/circuit') throw new Error('电路页面已改变，请重新打开参数');
            return JSON.stringify(Object.entries(names).flatMap(([id,label]) => {
              const node = document.getElementById(id);
              if (!node || node.disabled || node.closest('[hidden]') || getComputedStyle(node).display === 'none') return [];
              return [{id,label,value:node.value,options:node.tagName === 'SELECT' ? Array.from(node.options).map(option=>({value:option.value,title:option.textContent})) : []}];
            }));
            """, arguments: ["names":Self.names], in: nil, contentWorld: .page)
            guard let source = result as? String else { throw APIError.invalidResponse }
            fields = try JSONDecoder().decode([CircuitParameter].self, from: Data(source.utf8)); error = nil
        } catch { self.error = error.localizedDescription }
    }
    private func apply() async {
        guard let web = browser.webView else { return }
        do {
            let values = fields.filter { Self.names[$0.id] != nil }.map { ["id":$0.id,"value":$0.value] }
            _ = try await web.callAsyncJavaScript("""
            if (location.pathname !== '/circuit') throw new Error('电路页面已改变，请重新打开参数');
            for (const field of values) {
              const node = document.getElementById(field.id);
              if (!node || node.disabled) continue;
              node.value = field.value; node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true}));
            }
            """, arguments: ["values":values], in: nil, contentWorld: .page)
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
