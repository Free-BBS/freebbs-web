import SwiftUI
import WebKit

struct ChallengeOverview: View {
    let browser: LabBrowserState
    let panel: (String) -> Void
    @State private var levels = false
    private var state: SiteRecord { browser.challengeState }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button { levels = true } label: { Label(state["title"].text.isEmpty ? "选择关卡" : state["title"].text, systemImage: "list.number").lineLimit(1).frame(minHeight: 44) }
                    .disabled(state["levels"].list.isEmpty)
                    .accessibilityIdentifier("challenge-levels")
                Spacer()
                Button { panel("waves") } label: { Label("题目与波形", systemImage: "waveform.path").frame(minHeight: 44) }
            }.font(.subheadline.weight(.semibold))
            HStack(spacing: 12) {
                Text(state["count"].text).monospacedDigit()
                Text("误差 \(state["tolerance"].text)")
                Text(state["reward"].text)
            }.font(.caption).foregroundStyle(.secondary)
            if !state["status"].text.isEmpty {
                HStack {
                    Text(state["status"].text).font(.caption).lineLimit(2)
                    Spacer()
                    if state["canNext"].flag { Button("下一关") { browser.webView?.evaluateJavaScript("document.getElementById('challenge-next')?.click()") }.font(.subheadline.weight(.semibold)) }
                }
            }
        }.padding(.horizontal, 16).padding(.vertical, 10).background(.background)
        .sheet(isPresented: $levels) {
            NavigationStack {
                List {
                    ForEach(state["levels"].list.indices, id: \.self) { index in
                        let level = state["levels"].list[index]
                        Button {
                            browser.webView?.callAsyncJavaScript("window.freebbsChallengeCommand?.('level',id)", arguments: ["id":level["id"].text], in: nil, in: .page) { _ in }
                            levels = false
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(level["title"].text).foregroundStyle(.primary)
                                Text(level["detail"].text).font(.footnote).foregroundStyle(.secondary)
                            }
                        }.disabled(level["disabled"].flag)
                    }
                }.navigationTitle("选择关卡").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { levels = false } } }
            }
        }
    }
}

struct ChallengeParametersView: View {
    @Environment(\.dismiss) private var dismiss
    let browser: LabBrowserState
    @State private var fields: [CircuitParameter] = []
    @State private var selection = ""
    @State private var hint = ""
    @State private var canRotate = false
    @State private var canDelete = false
    @State private var canWire = false
    @State private var canResetWire = false
    @State private var error: String?
    @State private var applying = false
    var body: some View {
        Form {
            if let error { Text(error).foregroundStyle(.red) }
            Section {
                Text(selection.isEmpty ? "在画布上点选元件或导线" : selection).font(.headline)
                if !hint.isEmpty { Text(hint).foregroundStyle(.secondary) }
            }
            ForEach($fields) { $field in
                if field.options.isEmpty { TextField(field.label, text: $field.value).textInputAutocapitalization(.never).autocorrectionDisabled() }
                else { Picker(field.label, selection: $field.value) { ForEach(field.options) { Text($0.title).tag($0.value) } } }
            }
            if !selection.isEmpty {
                Section("编辑") {
                    Button("旋转", systemImage: "rotate.right") { command("rotate") }.disabled(!canRotate)
                    Button("从导线连线", systemImage: "point.topleft.down.to.point.bottomright.curvepath") { command("start-wire") }.disabled(!canWire)
                    Button("恢复自动走线") { command("reset-wire") }.disabled(!canResetWire)
                    Button("删除", systemImage: "trash", role: .destructive) { command("delete") }.disabled(!canDelete)
                }
            }
        }.navigationTitle("元件参数").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("应用") { Task { await apply() } }.disabled(applying || fields.isEmpty) }
        }.task { await read() }
    }
    private func read() async {
        guard let web = browser.webView else { return }
        do {
            let result = try await web.callAsyncJavaScript("""
            if(location.pathname!=='/circuit-challenge')throw new Error('工作区已改变');
            const byId=n=>document.getElementById('challenge-'+n);
            const selected=byId('selection');
            if(!selected||selected.hidden)return JSON.stringify({selection:'',hint:'请选择元件',fields:[]});
            const enabled=n=>!!byId(n)&&!byId(n).disabled&&!byId(n).hidden;
            return JSON.stringify({selection:byId('selected-name').textContent,hint:byId('parameters').querySelector('p')?.textContent||'',
              rotate:enabled('rotate'),remove:enabled('delete'),wire:enabled('start-wire'),resetWire:enabled('reset-wire'),
              fields:Array.from(byId('parameters').querySelectorAll('[data-parameter]')).filter(n=>/^[A-Za-z_][A-Za-z0-9_-]{0,47}$/.test(n.dataset.parameter)).map(n=>({id:n.dataset.parameter,label:Array.from(n.closest('label')?.childNodes||[]).filter(x=>x.nodeType===3).map(x=>x.textContent).join('').trim(),value:n.value,options:n.tagName==='SELECT'?Array.from(n.options).map(o=>({value:o.value,title:o.textContent})):[]}))});
            """, arguments: [:], in: nil, contentWorld: .page)
            guard let raw = result as? String else { throw APIError.invalidResponse }
            let record = try JSONDecoder().decode(SiteRecord.self, from: Data(raw.utf8))
            selection = record["selection"].text; hint = record["hint"].text
            fields = try record["fields"].decoded([CircuitParameter].self)
            canRotate = record["rotate"].flag; canDelete = record["remove"].flag; canWire = record["wire"].flag; canResetWire = record["resetWire"].flag
        } catch { self.error = error.localizedDescription }
    }
    private func apply() async {
        guard let web = browser.webView else { return }
        applying = true; defer { applying = false }
        do {
            _ = try await web.callAsyncJavaScript("""
            if(location.pathname!=='/circuit-challenge'||document.getElementById('challenge-selected-name')?.textContent!==selection)throw new Error('选择已改变，请重新打开参数');
            for(const field of values){
              const n=Array.from(document.querySelectorAll('#challenge-parameters [data-parameter]')).find(n=>n.dataset.parameter===field.id);
              if(!n||n.disabled||field.value.length>256)throw new Error('参数不可用');
              if(n.type==='number'&&(!field.value.trim()||!Number.isFinite(Number(field.value))))throw new Error('请输入有效数值');
              if(n.tagName==='SELECT'&&!Array.from(n.options).some(o=>o.value===field.value))throw new Error('选项已改变');
              n.value=field.value;n.dispatchEvent(new Event('change',{bubbles:true}));
              const current=Array.from(document.querySelectorAll('#challenge-parameters [data-parameter]')).find(n=>n.dataset.parameter===field.id);
              if(!current||(n.type==='number'?Number(current.value)!==Number(field.value):current.value!==field.value))throw new Error(document.getElementById('challenge-run-status')?.textContent||'参数未被接受');
            }
            """, arguments: ["selection":selection,"values":fields.map { ["id":$0.id,"value":$0.value] }], in: nil, contentWorld: .page)
            error = nil; dismiss()
        } catch { self.error = error.localizedDescription }
    }
    private func command(_ name: String) {
        browser.webView?.callAsyncJavaScript("""
        if(location.pathname==='/circuit-challenge'&&document.getElementById('challenge-selected-name')?.textContent===selection)document.getElementById('challenge-'+name)?.click();
        """, arguments: ["selection":selection,"name":name], in: nil, in: .page) { _ in }
        dismiss()
    }
}
