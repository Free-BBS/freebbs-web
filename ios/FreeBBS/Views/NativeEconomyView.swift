import SwiftUI

struct NativeEconomyView: View {
    @Environment(AppStore.self) private var store
    var inventory = false
    @State private var state = NativeWorkspace()
    @State private var selection: EconomySelection?
    @State private var search = ""
    private var items: [SiteRecord] { state.data[inventory ? "assets" : "shopItems"].list.filter { search.isEmpty || ($0["name"].text + $0["item"]["name"].text + $0["description"].text).localizedCaseInsensitiveContains(search) } }
    var body: some View {
        Group {
            if store.user == nil { NativeAccountRequired() }
            else { List {
                Section("钱包") {
                    LabeledContent("电元", value: String(store.user?.electrons ?? 0))
                    LabeledContent("磁元", value: String(store.user?.manetrons ?? 0))
                    LabeledContent("热力", value: String(store.user?.heat ?? 0))
                    NavigationLink { NativeLedgerView() } label: { Label("钱包账本", systemImage: "list.bullet.rectangle") }
                    NavigationLink { NativeEconomyView(inventory: !inventory) } label: { Label(inventory ? "电磁场商城" : "仓库", systemImage: inventory ? "bag" : "shippingbox") }
                }
                WorkspaceStatus(state: state)
                Section(inventory ? "我的资产" : "商品") {
                    if items.isEmpty && !state.loading { Text(inventory ? "暂无资产" : "没有匹配的商品").foregroundStyle(.secondary) }
                    ForEach(Array(items.enumerated()), id: \.offset) { _, record in
                        let item = inventory ? state.data["shopItems"].list.first(where: { $0["key"].text == record["key"].text }) ?? record["item"] : record
                        Button { selection = .init(item: item, asset: inventory ? record : .null) } label: {
                            HStack(spacing: 14) {
                                if let url = AppConfiguration.safeLink(item["image"].text, origin: store.configuration.origin), !item["image"].text.isEmpty {
                                    AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { Image(systemName: "shippingbox") }.frame(width: 60, height: 60)
                                }
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(item["name"].text.isEmpty ? record["key"].text : item["name"].text).font(.headline)
                                    Text(item["description"].text).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                    Text(inventory ? "数量 \(record["quantity"].int)" : EconomySelection.price(item)).font(.caption).foregroundStyle(Palette.teal)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }.padding(.vertical, 4)
                        }.buttonStyle(.plain)
                    }
                }
            }.refreshable { await load() }.searchable(text: $search, prompt: inventory ? "搜索资产" : "搜索商品") }
        }.navigationTitle(inventory ? "仓库与钱包" : "电磁场商城").navigationBarTitleDisplayMode(.inline)
        .task(id: store.sessionRevision) { await load() }
        .sheet(item: $selection) { item in NavigationStack { NativeEconomyDetail(selection: item) { Task { await load() } } }.environment(store) }
    }
    private func load() async {
        guard store.user != nil else { return }
        await state.load(store, path: "/api/electromagnetic")
        if let user = try? state.data["user"].decoded(User.self) { store.user = user }
    }
}
struct EconomySelection: Identifiable {
    let id = UUID(); let item: SiteRecord; let asset: SiteRecord
    static func price(_ item: SiteRecord) -> String {
        if item["purchasePolicy"]["soldOut"].flag { return "已达购买上限" }
        let cost = item["cost"]
        let prices = [("electric", "电元"), ("magnetic", "磁元")].compactMap { key, title in cost[key].int > 0 ? "\(cost[key].int) \(title)" : nil }
        return prices.joined(separator: item["priceMode"].text == "combined" ? " + " : " / ")
    }
}
struct NativeEconomyDetail: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let selection: EconomySelection
    let changed: () -> Void
    @State private var state = NativeWorkspace()
    @State private var currency = "electric"
    @State private var target = ""
    @State private var quantity = 1
    @State private var days = 1
    @State private var pending: EconomyAction?
    @State private var retry: EconomyAction?
    private var item: SiteRecord { selection.item }
    private var asset: SiteRecord { selection.asset }
    private var key: String { item["key"].text.isEmpty ? asset["key"].text : item["key"].text }
    private var owned: Bool { asset != .null }
    var body: some View {
        Form {
            Section {
                Text(item["name"].text.isEmpty ? key : item["name"].text).font(.title2.bold())
                Text(item["description"].text)
                if !item["rules"].text.isEmpty { Text(item["rules"].text).font(.subheadline).foregroundStyle(.secondary) }
                if owned { LabeledContent("数量", value: asset["quantity"].text) }
            }
            WorkspaceStatus(state: state)
            if !owned {
                Section("购买") {
                    Text(EconomySelection.price(item)).font(.headline)
                    if item["priceMode"].text != "combined" {
                        Picker("支付方式", selection: $currency) {
                            if item["cost"]["electric"].int > 0 { Text("电元").tag("electric") }
                            if item["cost"]["magnetic"].int > 0 { Text("磁元").tag("magnetic") }
                        }
                    }
                    Button("购买", systemImage: "bag.badge.plus") {
                        confirm("确认购买“\(item["name"].text)”？", path: "/api/electromagnetic/shop/\(NativeRoutes.component(key))/purchase", body: ["currency": item["priceMode"].text == "combined" ? "combined" : currency, "quotedCost": item["cost"].value, "expectedPurchaseCount": item["purchasePolicy"]["purchasedCount"].int])
                    }.disabled(item["purchasePolicy"]["soldOut"].flag || state.busy)
                }
            } else {
                if asset["isGift"].flag { Section("赠与") {
                    TextField("接收者 UID 或昵称", text: $target).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("赠与一个") { confirm("将一个资产赠与 \(target)？", path: "/api/electromagnetic/assets/\(NativeRoutes.component(key))/gift", body: ["target": target]) }.disabled(target.isEmpty || state.busy)
                } }
                if ["ordinary_fishbone", "golden_fishbone"].contains(asset["key"].text) { Section("出售") {
                    Stepper("出售 \(quantity) 个", value: $quantity, in: 1...max(1, asset["quantity"].int))
                    Text("收入 \(quantity * (asset["key"].text == "golden_fishbone" ? 10 : 1)) 磁元")
                    Button("确认出售") { confirm("出售 \(quantity) 个鱼骨？", path: "/api/shop/sell", body: ["itemKey": asset["key"].text, "quantity": quantity]) }.disabled(state.busy)
                } }
                if key == "differential_converter" { Section("转换") {
                    Button("电元转磁元") { confirm("转换 10 电元为 10 磁元？", path: "/api/electromagnetic/convert", body: ["direction": "electric_to_magnetic"]) }
                    Button("磁元转电元") { confirm("转换 10 磁元为 10 电元？", path: "/api/electromagnetic/convert", body: ["direction": "magnetic_to_electric"]) }
                } }
                if key == "golden_name_card" { Section { Button("使用黄金名片") { confirm("使用一张黄金名片？", path: "/api/electromagnetic/golden-name/use") } } }
                if key == "laser" { Section("激光器续期") {
                    Stepper("充值 \(days) 天", value: $days, in: 1...365)
                    Button("充值") { confirm("为激光器充值 \(days) 天？", path: "/api/electromagnetic/laser/charge", body: ["currency": "combined", "days": days, "quotedDailyPrice": item["laser"]["dailyPrice"].int, "quotedDailyMagnetic": item["laser"]["dailyMagnetic"].int]) }
                } }
                NavigationLink { NativeProfileExtrasView() } label: { Label("装扮与牧场", systemImage: "person.crop.circle") }
            }
            if let retry, state.error != nil { Button("重试原操作") { Task { await perform(retry) } }.disabled(state.busy) }
        }.navigationTitle("资产详情").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } } }
        .onAppear { currency = item["cost"]["electric"].int > 0 ? "electric" : "magnetic" }
        .confirmationDialog(pending?.title ?? "确认操作", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible) {
            if let pending { Button("确认") { let action = pending; self.pending = nil; Task { await perform(action) } } }
        }
    }
    private func confirm(_ title: String, path: String, body: [String: Any] = [:]) {
        var payload = body; payload["requestKey"] = UUID().uuidString
        pending = .init(title: title, path: path, body: payload)
    }
    private func perform(_ action: EconomyAction) async {
        retry = action // Retries use the same server receipt, never a second debit.
        if await state.mutate(store, path: action.path, body: action.body) != nil { retry = nil; changed(); dismiss() }
    }
}
struct EconomyAction { let title: String; let path: String; let body: [String: Any] }

struct NativeLedgerView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var currency = "all"
    @State private var rows: [SiteRecord] = []
    @State private var cursor = ""
    var body: some View {
        List {
            Picker("账本", selection: $currency) { Text("全部").tag("all"); Text("电元").tag("electric"); Text("磁元").tag("magnetic") }.pickerStyle(.segmented)
            WorkspaceStatus(state: state)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 6) {
                    Text(row["title"].text).font(.headline)
                    Text(row["reason"].text).foregroundStyle(.secondary)
                    Text("电元 \(row["electric_before"].text) → \(row["electric_after"].text) · 磁元 \(row["magnetic_before"].text) → \(row["magnetic_after"].text)").font(.caption).monospacedDigit()
                    Text(AppDates.short(row["created_at"].text)).font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 5)
            }
            if !cursor.isEmpty { Button("加载更多") { Task { await load(more: true) } }.disabled(state.loading) }
        }.navigationTitle("钱包账本").navigationBarTitleDisplayMode(.inline)
        .task(id: "\(store.sessionRevision)-\(currency)") { await load() }.refreshable { await load() }
    }
    private func load(more: Bool = false) async {
        if !more { rows = []; cursor = "" }
        var query = [URLQueryItem(name: "currency", value: currency)]
        if more { query.append(.init(name: "before", value: cursor)) }
        await state.load(store, path: "/api/wallet/ledger", query: query)
        if state.error == nil { rows += state.data["entries"].list; cursor = state.data["nextCursor"].text }
    }
}

struct NativeProfileExtrasView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    private let slots = [("frame", "头像框", [("frame_orbit", "轨道"), ("frame_aurora", "极光")]), ("nameplate", "名牌", [("plate_maxwell", "麦克斯韦"), ("plate_observer", "观察者"), ("plate_fishbone_master", "鱼骨大师"), ("plate_circuit_master", "电路大师")]), ("card", "主页卡片", [("card_blueprint", "蓝图"), ("card_twilight", "暮光")])]
    var body: some View {
        Form {
            WorkspaceStatus(state: state)
            Section("装扮与牧场") { FeatureLink(path: "/ranch"); FeatureLink(path: "/ranch-dye"); FeatureLink(path: "/ranch-gallery") }
            Section("穿戴装扮") {
                ForEach(slots, id: \.0) { slot, title, options in
                    Picker(title, selection: Binding(get: { state.data["equipped"][slot].text }, set: { key in Task {
                        if await state.mutate(store, path: "/api/profile/extras", body: ["action": "equip", "slot": slot, "itemKey": key, "requestKey": UUID().uuidString]) != nil { await state.load(store, path: "/api/profile/extras") }
                    } })) {
                        Text("不使用").tag("")
                        ForEach(options.filter { state.data["owned"].list.map(\.text).contains($0.0) || state.data["equipped"][slot].text == $0.0 }, id: \.0) { key, label in Text(label).tag(key) }
                    }.disabled(state.busy || state.loading)
                }
            }
        }.navigationTitle("装扮与牧场").task(id: store.sessionRevision) { await state.load(store, path: "/api/profile/extras") }
    }
}
