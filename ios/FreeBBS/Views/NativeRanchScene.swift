import SwiftUI
import WebKit

enum RanchScenePolicy {
    static let paths: Set<String> = ["/ranch", "/ranch-gallery"]
    static var previewURL: URL { Bundle.main.url(forResource: "RanchPreview", withExtension: "html")! }
    static let start = """
    (() => {
      if (!['/ranch','/ranch-gallery'].includes(location.pathname) && location.protocol !== 'file:') return;
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => original(/^\\(min-width:\\s*901px\\)$/.test(query) ? '(min-width: 0px)' : query);
    })();
    """
    static var mobile: String { try! String(contentsOf: Bundle.main.url(forResource: "NativeRanchScene", withExtension: "js")!, encoding: .utf8) }
}

struct NativeRanchScene: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    let uid: String?
    let gallery: Bool
    @State private var browser = LabBrowserState()
    @State private var care = false
    private var state: SiteRecord { browser.ranchState }
    private var study: Bool { state["study"].flag }
    private var destination: LabDestination {
        .init(title: gallery ? "羊群广场" : "电子牧场", path: gallery ? "/ranch-gallery" : "/ranch" + (uid.map { "?uid=" + NativeRoutes.component($0) } ?? ""))
    }
    var body: some View {
        VStack(spacing: 0) {
            if browser.loading { ProgressView(value: browser.progress).tint(Palette.teal) }
            if let error = browser.error {
                ContentUnavailableView("牧场暂时无法加载", systemImage: "wifi.exclamationmark", description: Text(error))
                Button("重试") { browser.error = nil; browser.webView?.reload() }
            }
            GeometryReader { geometry in
                LabWebView(destination: destination, origin: store.configuration.origin, token: store.api.token,
                           dark: colorScheme == .dark, browser: browser, login: { store.showLogin = true }, includeFeatures: true, store: store, ranchScene: true)
                    .id(store.sessionRevision)
                    .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                    .accessibilityIdentifier("ranch-scene")
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
            if !state["status"].text.isEmpty && !study {
                Text(state["status"].text).font(.footnote).foregroundStyle(.secondary).lineLimit(3).padding(.horizontal).padding(.vertical, 6)
            }
            if study { studyControls.fixedSize(horizontal: false, vertical: true).layoutPriority(1) }
            else if gallery && !state["selectedName"].text.isEmpty { selectedControls }
            else if !gallery {
                HStack {
                    Button("喂养", systemImage: "fish") { command("feed") }.disabled(!state["feed"].flag)
                    Spacer()
                    Button("招呼", systemImage: "hand.wave") { command("greet") }.disabled(!state["greet"].flag)
                    Spacer()
                    Button("照顾与收藏", systemImage: "leaf") { care = true }
                }.padding(.horizontal, 20).frame(minHeight: 52)
            }
        }.background(Palette.canvas).tint(Palette.teal)
        .navigationTitle(study ? "牧场学习" : destination.title).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if study { Button("完成") { command("study", false) } }
                else {
                    if !gallery { Button("牧场学习", systemImage: "timer") { command("study", true) }.disabled(!state["ready"].flag) }
                    Menu {
                        sceneMenu
                        if gallery {
                            Button("找到我的羊", systemImage: "scope") { command("findMine") }.disabled(!state["findMine"].flag)
                            Button("使用三叶草", systemImage: "leaf") { command("clover") }.disabled(!state["clover"].flag)
                            FeatureLink(path: "/ranch")
                        } else {
                            Button(state["paused"].flag ? "继续动态" : "暂停动态", systemImage: state["paused"].flag ? "play" : "pause") { command("pause") }
                            FeatureLink(path: "/ranch-gallery")
                        }
                        FeatureLink(path: "/ranch-dye")
                        Button("刷新", systemImage: "arrow.clockwise") { browser.webView?.reload() }
                    } label: { Image(systemName: "ellipsis") }.accessibilityLabel("牧场操作")
                }
            }
        }
        .sheet(isPresented: $care, onDismiss: { Task { await refreshCare() } }) { NavigationStack { RanchCareView().environment(store) } }
        .sheet(item: $browser.nextFeature) { destination in NavigationStack { FeatureWorkspaceView(destination: destination) }.environment(store) }
        .alert("牧场", isPresented: $browser.presentingDialog, presenting: browser.dialog) { dialog in
            if dialog.kind == .text { TextField("输入内容", text: $browser.promptText) }
            if dialog.kind != .notice { Button("取消", role: .cancel) { browser.resolveDialog(nil) } }
            Button("确定") { browser.resolveDialog(dialog.kind == .text ? browser.promptText : "confirmed") }
        } message: { dialog in Text(dialog.message) }
        .onDisappear { browser.resolveDialog(nil) }
    }
    private var sceneMenu: some View {
        Menu("场景", systemImage: "photo") {
            ForEach([("meadow", "草甸"), ("lake", "湖畔"), ("courtyard", "庭院"), ("wall", "长城")], id: \.0) { key, name in
                Button { command("scene", key) } label: { if state["scene"].text == key { Label(name, systemImage: "checkmark") } else { Text(name) } }
            }
        }
    }
    private var studyControls: some View {
        VStack(spacing: 8) {
            if verticalSizeClass == .compact {
                HStack(spacing: 20) { studyToggles; if state["focus"].flag { timerControls } }
            } else {
                studyToggles
                if state["focus"].flag { timerControls }
            }
        }.font(.subheadline).padding(.horizontal, 20).padding(.vertical, 8)
    }
    private var studyToggles: some View {
        HStack {
            Button { command("clock") } label: { Label("时钟", systemImage: state["clock"].flag ? "checkmark.circle.fill" : "circle").frame(minHeight: 44) }
                .accessibilityIdentifier("ranch-clock")
            Spacer()
            Button { command("focus") } label: { Label("专注计时", systemImage: state["focus"].flag ? "checkmark.circle.fill" : "circle").frame(minHeight: 44) }
                .accessibilityIdentifier("ranch-focus")
            Spacer()
            Button { command("pause") } label: { Image(systemName: state["paused"].flag ? "play" : "pause").frame(width: 44, height: 44) }.accessibilityLabel("切换场景动态")
        }
    }
    private var timerControls: some View {
        HStack {
            Menu { ForEach([15, 25, 45, 60], id: \.self) { value in Button("\(value) 分钟") { command("minutes", value) } } }
                label: { Text("\(state["minutes"].int) 分钟").frame(minHeight: 44) }.disabled(state["running"].flag)
            Spacer()
            Button(state["running"].flag ? "暂停" : "开始", systemImage: state["running"].flag ? "pause.fill" : "play.fill") { command("start") }
                .buttonStyle(.borderedProminent).accessibilityIdentifier("ranch-start")
            Spacer()
            Button { command("reset") } label: { Text("重置").frame(minHeight: 44) }.accessibilityIdentifier("ranch-reset")
        }
    }
    private var selectedControls: some View {
        HStack {
            Menu(state["selectedName"].text) {
                ForEach(state["actions"].list.indices, id: \.self) { index in
                    let item = state["actions"].list[index]
                    Button(item["title"].text) { command("action", item["id"].text) }
                }
                if state["canEquip"].flag {
                    Menu("出行装备") { ForEach(state["gears"].list.indices, id: \.self) { index in
                        let item = state["gears"].list[index]; Button(item["title"].text) { command("gear", item["id"].text) }
                    } }
                }
                if !state["selectedUid"].text.isEmpty { NavigationLink("逛逛 TA 的牧场") { NativeRanchView(uid: state["selectedUid"].text) } }
            }
            Spacer()
            Button("取消选择", systemImage: "xmark") { command("closeSelection") }
        }.padding(.horizontal, 20).frame(minHeight: 52)
    }
    private func refreshCare() async {
        guard !store.isDemo, let owner = store.user?.uid, uid == nil || uid == owner, let web = browser.webView else { return }
        let session = store.sessionRevision
        do {
            let response: SiteRecord = try await store.api.request("/api/users/" + NativeRoutes.component(owner) + "/public-profile")
            guard session == store.sessionRevision, browser.webView === web else { return }
            _ = try await web.callAsyncJavaScript("return window.FreeBbsProfileExtras?.renderProfile(profile)", arguments: ["profile": response["profile"].value], in: nil, contentWorld: .page)
        } catch { browser.error = error.localizedDescription }
    }
    private func command(_ name: String, _ value: Any = "") {
        browser.webView?.callAsyncJavaScript("window.freebbsRanchCommand?.(name,value)", arguments: ["name":name, "value":value], in: nil, in: .page) { _ in }
    }
}

private struct RanchCareView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var state = NativeWorkspace()
    @State private var action: String?
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            Section("收藏") {
                LabeledContent("小鱼", value: state.data["fish"].text)
                LabeledContent("普通鱼骨", value: state.data["ranch"]["bones"].text)
                LabeledContent("黄金鱼骨", value: state.data["ranch"]["goldenBones"].text)
                LabeledContent("羊毛", value: state.data["ranch"]["woolReady"].flag ? "可以剪取" : "生长中")
            }
            Section("照顾我的 Max") {
                ForEach([("adopt", "领养"), ("feed", "喂食"), ("shear", "剪羊毛"), ("rub_wool", "摩擦羊毛"), ("use_bag", "使用福袋")], id: \.0) { key, title in
                    Button(title) { action = key }.disabled(state.busy)
                }
                FeatureLink(path: "/electromagnetic")
                FeatureLink(path: "/ranch-dye")
            }
        }.navigationTitle("照顾与收藏").toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } } }
        .task(id: store.sessionRevision) { await state.load(store, path: "/api/profile/extras") }
        .confirmationDialog("确认照顾操作？", isPresented: Binding(get: { action != nil }, set: { if !$0 { action = nil } }), titleVisibility: .visible) {
            if let action { Button("确认") { self.action = nil; Task { if await state.mutate(store, path: "/api/profile/extras", body: ["action": action, "requestKey": UUID().uuidString]) != nil { await state.load(store, path: "/api/profile/extras") } } } }
        }
    }
}
