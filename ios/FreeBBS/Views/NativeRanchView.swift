import SwiftUI
import UIKit

struct SheepDesign: Codable, Equatable {
    struct Part: Codable, Equatable { var base: String?; var layers: [Layer] = [] }
    struct Horns: Codable, Equatable { var left: String?; var right: String? }
    struct Layer: Codable, Equatable { var mode: String; var blend: String; var color: String; var x: Double; var y: Double; var radius: Double; var opacity: Double; var angle: Double }
    var version = 1
    var wool = Part()
    var face = Part()
    var horns = Horns()
    var object: [String: Any] { (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) as? [String: Any] ?? [:] }
}
extension Color {
    init(sheepHex: String?, fallback: Color = .white) {
        guard let hex = sheepHex, hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { self = fallback; return }
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
    var sheepHex: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}
struct NativeSheep: View {
    var design = SheepDesign()
    var body: some View {
        Canvas { context, size in
            let width = size.width, height = size.height
            let wool = CGRect(x: width * 0.12, y: height * 0.1, width: width * 0.76, height: height * 0.66)
            let face = CGRect(x: width * 0.32, y: height * 0.34, width: width * 0.36, height: height * 0.45)
            for x in [0.31, 0.62] { context.fill(Path(roundedRect: CGRect(x: width * x, y: height * 0.68, width: width * 0.07, height: height * 0.21), cornerRadius: width * 0.035), with: .color(Color(sheepHex: design.face.base, fallback: .gray))) }
            paint(&context, part: design.wool, rect: wool, shape: Path(ellipseIn: wool), fallback: Color(.systemGray6))
            for x in [0.20, 0.68] { context.fill(Path(ellipseIn: CGRect(x: width * x, y: height * 0.40, width: width * 0.14, height: height * 0.09)), with: .color(Color(sheepHex: design.face.base, fallback: Color(red: 0.32, green: 0.36, blue: 0.39)))) }
            paint(&context, part: design.face, rect: face, shape: Path(roundedRect: face, cornerRadius: width * 0.17), fallback: Color(red: 0.32, green: 0.36, blue: 0.39))
            for x in [0.42, 0.56] { context.fill(Path(ellipseIn: CGRect(x: width * x, y: height * 0.51, width: width * 0.035, height: height * 0.04)), with: .color(.white)) }
            for (x, horn) in [(0.25, design.horns.left), (0.65, design.horns.right)] {
                if let horn { context.fill(Path(roundedRect: CGRect(x: width * x, y: height * 0.28, width: width * 0.10, height: height * 0.20), cornerRadius: width * 0.04), with: .color(horn == "gold" ? .yellow : .gray)) }
            }
        }.accessibilityLabel("绵羊花纹预览")
    }
    private func paint(_ context: inout GraphicsContext, part: SheepDesign.Part, rect: CGRect, shape: Path, fallback: Color) {
        context.fill(shape, with: .color(Color(sheepHex: part.base, fallback: fallback)))
        var clipped = context; clipped.clip(to: shape)
        for layer in part.layers {
            var drawing = clipped; drawing.opacity = layer.opacity
            drawing.blendMode = ["multiply": .multiply, "screen": .screen, "overlay": .overlay, "soft-light": .softLight][layer.blend] ?? .normal
            let center = CGPoint(x: rect.minX + rect.width * layer.x, y: rect.minY + rect.height * layer.y)
            let radius = rect.width * layer.radius
            drawing.translateBy(x: center.x, y: center.y); drawing.rotate(by: .degrees(layer.angle))
            let color = Color(sheepHex: layer.color)
            if layer.mode == "stripes" {
                for index in -4...4 { drawing.fill(Path(CGRect(x: CGFloat(index) * radius / 3, y: -radius, width: radius / 7, height: radius * 2)), with: .color(color)) }
            } else if layer.mode == "rings" {
                for index in 1...4 { let r = radius * Double(index) / 4; drawing.stroke(Path(ellipseIn: CGRect(x: -r, y: -r, width: r * 2, height: r * 2)), with: .color(color), lineWidth: max(1, radius / 10)) }
            } else if layer.mode == "spiral" {
                var line = Path()
                for i in 0...120 { let a = Double(i) / 120 * .pi * 6, r = Double(i) / 120 * radius; let p = CGPoint(x: cos(a) * r, y: sin(a) * r); if i == 0 { line.move(to: p) } else { line.addLine(to: p) } }
                drawing.stroke(line, with: .color(color), lineWidth: max(1, radius / 10))
            } else { drawing.fill(Path(ellipseIn: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2)), with: .color(color)) }
        }
    }
}

struct NativeRanchView: View {
    @Environment(AppStore.self) private var store
    var uid: String? = nil
    var gallery = false
    @State private var state = NativeWorkspace()
    @State private var extras = NativeWorkspace()
    @State private var study = false
    @State private var selected: RanchSheepSelection?
    @State private var action: EconomyAction?
    @State private var retry: EconomyAction?
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            if uid == nil {
                Section("共享牧场") {
                    Menu("牧场场景", systemImage: "leaf") {
                        ForEach([("meadow", "草地"), ("lake", "湖边"), ("courtyard", "庭院"), ("wall", "墙边")], id: \.0) { key, name in Button(name) { confirm("将共享牧场切换到\(name)？", path: "/api/ranch-world/actions", body: ["kind": "scene", "scene": key]) } }
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: 16) {
                        ForEach(Array(state.data["sheep"].list.enumerated()), id: \.offset) { _, sheep in
                            Button { selected = .init(record: sheep) } label: {
                                VStack {
                                    NativeSheep(design: (try? sheep["design"].decoded(SheepDesign.self)) ?? .init()).frame(height: 100)
                                    Text(sheep["username"].text).font(.caption).foregroundStyle(.primary).lineLimit(2)
                                }.frame(maxWidth: .infinity)
                            }.buttonStyle(.plain)
                        }
                    }.padding(.vertical, 12)
                    if state.data["sheep"].list.isEmpty && !state.loading { Text("羊群暂时走远了。").foregroundStyle(.secondary) }
                }
            } else {
                Section {
                    NativeSheep(design: (try? state.data["design"].decoded(SheepDesign.self)) ?? .init()).frame(height: 220)
                    Text(state.data["username"].text).font(.headline)
                }
            }
            if store.user != nil {
                Section("我的羊") {
                    WorkspaceStatus(state: extras)
                    ForEach([("adopt", "领养"), ("feed", "喂食"), ("shear", "剪羊毛"), ("rub_wool", "摩擦羊毛"), ("use_bag", "使用福袋")], id: \.0) { kind, title in
                        Button(title) { confirm("确认\(title)？", path: "/api/profile/extras", body: ["action": kind]) }.disabled(state.busy)
                    }
                    Menu("行走装备") {
                        ForEach([("walk", "步行"), ("bicycle", "自行车"), ("wing", "飞行翅膀")], id: \.0) { mode, label in Button(label) { confirm("装备\(label)？", path: "/api/ranch-world/actions", body: ["kind": "equip", "actor": store.user?.uid ?? "", "mode": mode]) } }
                    }
                    FeatureLink(path: "/ranch-dye")
                    LabeledContent("鱼", value: extras.data["fish"].text)
                }
            }
            if let retry, state.error != nil { Button("重试原操作") { Task { await perform(retry) } }.disabled(state.busy) }
        }.navigationTitle(gallery ? "羊群广场" : "电子牧场").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("牧场学习", systemImage: "timer") { study = true } } }
        .sheet(isPresented: $study) { NativeRanchStudy().environment(store) }
        .task(id: store.sessionRevision) { await load() }.refreshable { await load() }
        .sheet(item: $selected) { selection in
            NavigationStack {
                List {
                    NativeSheep(design: (try? selection.record["design"].decoded(SheepDesign.self)) ?? .init()).frame(height: 220)
                    ForEach([("greet", "打招呼"), ("pet", "摸摸羊"), ("stroll", "散步"), ("backflip", "后空翻"), ("bicycle", "骑自行车"), ("fly", "飞行"), ("clover", "赠送三叶草")], id: \.0) { kind, title in
                        Button(title) { selected = nil; confirm("确认\(title)？", path: "/api/ranch-world/actions", body: ["kind": kind, "actor": ["stroll", "backflip", "bicycle", "fly"].contains(kind) ? store.user?.uid ?? "" : selection.record["uid"].text, "target": selection.record["uid"].text]) }
                    }
                }.navigationTitle(selection.record["username"].text)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { selected = nil } } }
            }
        }
        .confirmationDialog(action?.title ?? "确认操作", isPresented: Binding(get: { action != nil }, set: { if !$0 { action = nil } }), titleVisibility: .visible) {
            if let action { Button("确认") { self.action = nil; Task { await perform(action) } } }
        }
    }
    private func load() async {
        await state.load(store, path: uid.map { "/api/ranch-designs/" + NativeRoutes.component($0) } ?? "/api/ranch-world")
        if store.user != nil { await extras.load(store, path: "/api/profile/extras") }
    }
    private func confirm(_ title: String, path: String, body: [String: Any]) { var body = body; body["requestKey"] = UUID().uuidString; action = .init(title: title, path: path, body: body) }
    private func perform(_ action: EconomyAction) async { retry = action; if await state.mutate(store, path: action.path, body: action.body) != nil { retry = nil; await load() } }
}
struct RanchSheepSelection: Identifiable { let id = UUID(); let record: SiteRecord }

struct NativeDyeView: View {
    @Environment(AppStore.self) private var store
    @State private var state = NativeWorkspace()
    @State private var design = SheepDesign()
    @State private var history: [SheepDesign] = []
    @State private var part = "wool"
    @State private var color = Color.pink
    @State private var mode = "splat"
    @State private var blend = "normal"
    @State private var radius = 0.15
    @State private var opacity = 0.8
    @State private var angle = 0.0
    var body: some View {
        Form {
            Section {
                GeometryReader { geometry in
                    NativeSheep(design: design).contentShape(Rectangle()).gesture(SpatialTapGesture().onEnded { tap in
                        guard (part == "wool" ? design.wool.layers.count : design.face.layers.count) < 64 else { state.error = "每个部位最多 64 个花纹。"; return }
                        checkpoint()
                        let rect = part == "wool" ? CGRect(x: geometry.size.width * 0.12, y: 24, width: geometry.size.width * 0.76, height: 158.4) : CGRect(x: geometry.size.width * 0.32, y: 81.6, width: geometry.size.width * 0.36, height: 108)
                        let layer = SheepDesign.Layer(mode: mode, blend: blend, color: color.sheepHex, x: min(1, max(0, (tap.location.x - rect.minX) / rect.width)), y: min(1, max(0, (tap.location.y - rect.minY) / rect.height)), radius: radius, opacity: opacity, angle: angle)
                        if part == "wool" { design.wool.layers.append(layer) } else { design.face.layers.append(layer) }
                    })
                }.frame(height: 240).accessibilityIdentifier("nativeDyeCanvas")
                Text("点击绵羊添加花纹；保存后同步到牧场和个人主页。").font(.footnote).foregroundStyle(.secondary)
            }
            WorkspaceStatus(state: state)
            Section("绘制") {
                Picker("部位", selection: $part) { Text("羊毛").tag("wool"); Text("脸部").tag("face") }.pickerStyle(.segmented)
                ColorPicker("颜色", selection: $color, supportsOpacity: false)
                Picker("花纹", selection: $mode) { Text("色斑").tag("splat"); Text("圆环").tag("rings"); Text("条纹").tag("stripes"); Text("螺旋").tag("spiral") }
                Picker("混合", selection: $blend) { Text("正常").tag("normal"); Text("正片叠底").tag("multiply"); Text("滤色").tag("screen"); Text("叠加").tag("overlay"); Text("柔光").tag("soft-light") }
                LabeledContent("大小") { Slider(value: $radius, in: 0.04...1) }
                LabeledContent("不透明度") { Slider(value: $opacity, in: 0.05...1) }
                LabeledContent("角度") { Slider(value: $angle, in: 0...360) }
                Button("设为底色") { checkpoint(); if part == "wool" { design.wool.base = color.sheepHex } else { design.face.base = color.sheepHex } }
                Button("清空当前部位", role: .destructive) { checkpoint(); if part == "wool" { design.wool = .init() } else { design.face = .init() } }
            }
            Section {
                Button("添加居中花纹", systemImage: "plus") {
                    guard (part == "wool" ? design.wool.layers.count : design.face.layers.count) < 64 else { state.error = "每个部位最多 64 个花纹。"; return }
                    checkpoint(); let layer = SheepDesign.Layer(mode: mode, blend: blend, color: color.sheepHex, x: 0.5, y: 0.5, radius: radius, opacity: opacity, angle: angle)
                    if part == "wool" { design.wool.layers.append(layer) } else { design.face.layers.append(layer) }
                }
            }
            Section("角饰") {
                Picker("左角", selection: $design.horns.left) { Text("无").tag(String?.none); Text("金角").tag(String?.some("gold")); Text("银角").tag(String?.some("silver")) }
                Picker("右角", selection: $design.horns.right) { Text("无").tag(String?.none); Text("金角").tag(String?.some("gold")); Text("银角").tag(String?.some("silver")) }
            }
        }.navigationTitle("羊的染坊").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("撤销", systemImage: "arrow.uturn.backward") { if let previous = history.popLast() { design = previous } }.disabled(history.isEmpty) }
            ToolbarItem(placement: .confirmationAction) { Button("保存") { Task {
                if let result = await state.mutate(store, path: "/api/ranch-designs/mine", method: "PUT", body: ["design": design.object, "revision": state.data["revision"].int]) { state.data = .object(result.fields.merging(["adopted": .bool(true)]) { old, _ in old }); state.notice = "花纹已保存。"; history = [] }
            } }.disabled(state.busy || state.loading || state.data["adopted"].flag == false) }
        }
        .task(id: store.sessionRevision) {
            history = []; design = .init(); await state.load(store, path: "/api/ranch-designs/mine")
            design = (try? state.data["design"].decoded(SheepDesign.self)) ?? .init()
        }
    }
    private func checkpoint() { history.append(design); if history.count > 64 { history.removeFirst() } }
}
