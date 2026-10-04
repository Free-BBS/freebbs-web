import XCTest
import WebKit
import UIKit
@testable import FreeBBS

@MainActor final class SceneInteractionTests: XCTestCase {
    func testProductionRanchPreviewShowsWebsiteSheepBackgroundAndPersistentCountdown() async throws {
        let origin = URL(string: "https://www.free-bbs.cn")!
        let suite = "ranch-regression-" + UUID().uuidString
        let preferences = try XCTUnwrap(UserDefaults(suiteName: suite)); defer { preferences.removePersistentDomain(forName: suite) }
        let store = AppStore(api: APIClient(origin: origin), preferences: preferences); store.isDemo = true
        let browser = LabBrowserState()
        let host = LabWebView(destination: .init(title: "电子牧场", path: "/ranch"), origin: origin, token: nil, dark: false,
                              browser: browser, login: {}, includeFeatures: true, store: store, ranchScene: true)
        let coordinator = host.makeCoordinator(); let web = host.makeWebView(coordinator: coordinator)
        web.frame = CGRect(x: 0, y: 0, width: 320, height: 540)
        let previousWindow = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow)
        let window = previousWindow?.windowScene.map { UIWindow(windowScene: $0) } ?? UIWindow(frame: web.frame)
        window.rootViewController = UIViewController(); window.rootViewController?.view.addSubview(web)
        window.makeKeyAndVisible()
        defer { LabWebView.dismantleUIView(web, coordinator: coordinator); window.isHidden = true; previousWindow?.makeKeyAndVisible() }
        for _ in 0..<150 { if browser.ranchState["ready"].flag { break }; try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertTrue(browser.ranchState["ready"].flag)
        XCTAssertEqual(web.url, RanchScenePolicy.previewURL)
        let visual = try await web.callAsyncJavaScript("""
        const sheep=document.querySelector('[data-max-actor] svg');
        const scene=document.querySelector('.ranch-scenery');
        const background=getComputedStyle(scene).backgroundImage;
        const photo=new Image();photo.src=background.match(/url\\("?(data:[^"]+)"?\\)/)?.[1]||'';
        const decoded=await new Promise(resolve=>{photo.onload=()=>resolve(photo.naturalWidth);photo.onerror=()=>resolve(0);if(photo.complete)resolve(photo.naturalWidth);});
        return {decoded,sheep:!!sheep,background,width:innerWidth,height:document.querySelector('.ranch-scene').getBoundingClientRect().height,chrome:getComputedStyle(document.querySelector('.ranch-scene-heading')).display};
        """, arguments: [:], in: nil, contentWorld: .page) as? [String:Any]
        XCTAssertEqual(visual?["sheep"] as? Bool, true)
        XCTAssertGreaterThan(visual?["decoded"] as? Int ?? 0, 0)
        XCTAssertTrue((visual?["background"] as? String)?.contains("data:image/webp") == true)
        XCTAssertEqual(visual?["width"] as? Int, 320)
        XCTAssertGreaterThan(visual?["height"] as? Double ?? 0, 500)
        XCTAssertEqual(visual?["chrome"] as? String, "none")
        func command(_ name: String, _ value: Any = "") async throws {
            _ = try await web.callAsyncJavaScript("window.freebbsRanchCommand(name,value)", arguments: ["name":name,"value":value], in: nil, contentWorld: .page)
            try await Task.sleep(for: .milliseconds(250))
        }
        try await command("study", true); XCTAssertTrue(browser.ranchState["study"].flag)
        try await command("focus"); XCTAssertTrue(browser.ranchState["focus"].flag)
        XCTAssertEqual(browser.ranchState["countdown"].text, "25:00")
        try await command("minutes", 15); XCTAssertEqual(browser.ranchState["countdown"].text, "15:00")
        try await command("start"); XCTAssertTrue(browser.ranchState["running"].flag)
        for _ in 0..<30 { if browser.ranchState["countdown"].text != "15:00" { break }; try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertNotEqual(browser.ranchState["countdown"].text, "15:00")
        try await command("study", false); XCTAssertFalse(browser.ranchState["study"].flag)
        try await command("study", true); XCTAssertTrue(browser.ranchState["running"].flag)
        try await command("start"); XCTAssertFalse(browser.ranchState["running"].flag)
        let paused = browser.ranchState["countdown"].text
        try await Task.sleep(for: .seconds(1.2)); XCTAssertEqual(browser.ranchState["countdown"].text, paused)
        try await command("reset"); XCTAssertEqual(browser.ranchState["countdown"].text, "15:00")
        try await command("scene", "lake"); XCTAssertEqual(browser.ranchState["scene"].text, "lake")
        web.frame = CGRect(x: 0, y: 0, width: 740, height: 280)
        try await Task.sleep(for: .milliseconds(250))
        let landscape = try await web.callAsyncJavaScript("return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,readout:document.querySelector('.ranch-study-readout').getBoundingClientRect().bottom,height:innerHeight}", arguments: [:], in: nil, contentWorld: .page) as? [String:Any]
        XCTAssertEqual(landscape?["width"] as? Int, 740); XCTAssertEqual(landscape?["overflow"] as? Bool, false)
        XCTAssertLessThan(landscape?["readout"] as? Double ?? 1000, landscape?["height"] as? Double ?? 0)
    }

    func testRanchRendererOnlyAllowsItsTwoTrustedPages() {
        let origin=URL(string:"https://www.free-bbs.cn")!, browser=LabBrowserState()
        let host=LabWebView(destination:.init(title:"电子牧场",path:"/ranch"),origin:origin,token:nil,dark:false,browser:browser,login:{},includeFeatures:true,ranchScene:true)
        XCTAssertTrue(host.allowed(URL(string:"https://www.free-bbs.cn/ranch?uid=alice")!))
        XCTAssertTrue(host.allowed(URL(string:"https://www.free-bbs.cn/ranch-gallery")!))
        for raw in ["https://www.free-bbs.cn/settings","https://www.free-bbs.cn/api/auth/me","https://attacker.test/ranch","http://www.free-bbs.cn/ranch","https://user:secret@www.free-bbs.cn/ranch","https://www.free-bbs.cn/development"] { XCTAssertFalse(host.allowed(URL(string:raw)!)) }
    }

    func testChallengeAdapterKeepsActualDisabledControlsAndParameterSelection() async throws {
        let config=WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        let web=WKWebView(frame:CGRect(x:0,y:0,width:320,height:540),configuration:config)
        web.loadHTMLString("<html class='freebbs-native-lab'><body><main class='challenge-main'><h2 id='challenge-title'>第一关</h2><div id='circuit-stage'></div><div id='challenge-level-list'><button data-challenge-id='one' aria-current='step' disabled><strong>第一关</strong><small>未解锁</small></button><button data-challenge-id='two'><strong>第二关</strong></button></div><div id='challenge-palette'><button data-add='resistor'>电阻</button></div><button id='challenge-run'>测试</button><button id='challenge-submit' disabled>提交</button><button id='challenge-next' hidden>下一关</button></main></body></html>",baseURL:URL(string:"https://www.free-bbs.cn/circuit-challenge")!)
        for _ in 0..<100 { if (try? await web.evaluateJavaScript("!!document.getElementById('challenge-title')")) as? Bool == true { break };try await Task.sleep(for:.milliseconds(100)) }
        _ = try await web.evaluateJavaScript("window.fitCount=0;document.getElementById('circuit-stage').addEventListener('freebbs-native-fit',()=>window.fitCount++);window.captured=[];window.webkit={messageHandlers:{site:{postMessage:async x=>captured.push(x)}}};window.FreeBbsCircuitMobile={show:name=>window.previousPanel=name};document.querySelector('[data-add]').addEventListener('click',()=>window.added=true);document.querySelector('[data-challenge-id=one]').addEventListener('click',()=>window.lockedClicked=true);")
        let script=try String(contentsOf:Bundle.main.url(forResource:"NativeChallenge",withExtension:"js")!,encoding:.utf8)
        _ = try await web.callAsyncJavaScript("new Function('location',script)({pathname:'/circuit-challenge'})", arguments:["script":script], in:nil, contentWorld:.page)
        let state = try await web.evaluateJavaScript("JSON.parse(captured[0].value)") as? [String:Any]
        XCTAssertEqual(state?["canRun"] as? Bool,true);XCTAssertEqual(state?["canSubmit"] as? Bool,false);XCTAssertEqual(state?["canNext"] as? Bool,false)
        _ = try await web.evaluateJavaScript("freebbsChallengeCommand('level','one');freebbsChallengeCommand('part','resistor');FreeBbsCircuitMobile.show('parameters');")
        let result0=try await web.evaluateJavaScript("!!window.lockedClicked") as? Bool;XCTAssertEqual(result0,false)
        let result1=try await web.evaluateJavaScript("!!window.added") as? Bool;XCTAssertEqual(result1,true)
        let result2=try await web.evaluateJavaScript("captured.at(-1).type") as? String;XCTAssertEqual(result2,"challengeParameters")
        _ = try await web.evaluateJavaScript("FreeBbsCircuitMobile.show('waves')")
        let result3=try await web.evaluateJavaScript("window.previousPanel") as? String;XCTAssertEqual(result3,"waves")
        try await Task.sleep(for: .milliseconds(250))
        let firstFit = try await web.evaluateJavaScript("window.fitCount") as? Int
        XCTAssertEqual(firstFit, 1)
        _ = try await web.evaluateJavaScript("document.querySelector('[data-challenge-id=one]').removeAttribute('aria-current');document.querySelector('[data-challenge-id=two]').setAttribute('aria-current','step');document.getElementById('challenge-run').hidden=true")
        try await Task.sleep(for: .milliseconds(250))
        let changed = try await web.evaluateJavaScript("({fit:fitCount,state:JSON.parse(captured.filter(x=>x.type==='challengeState').at(-1).value)})") as? [String:Any]
        XCTAssertEqual(changed?["fit"] as? Int, 2)
        XCTAssertEqual((changed?["state"] as? [String:Any])?["canRun"] as? Bool, false)
        web.stopLoading()
    }
}
