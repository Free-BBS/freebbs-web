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
    var uid: String? = nil
    var gallery = false
    var body: some View { NativeRanchScene(uid: uid, gallery: gallery) }
}

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
