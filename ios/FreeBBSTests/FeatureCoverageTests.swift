import XCTest
import WebKit
@testable import FreeBBS

@MainActor final class FeatureCoverageTests: XCTestCase, WKNavigationDelegate {
    private let origin = URL(string: "https://www.free-bbs.cn")!
    private var loaded: XCTestExpectation?
    private func user(_ uid: String, admin: Bool = false) -> User {
        .init(id: 42, uid: uid, username: uid, fullName: uid, studentId: "2026000000", email: nil, role: "student", isAdmin: admin, bio: "", websiteUrl: "", avatarPath: "", electrons: 0, manetrons: 0, heat: 0, requiresUsernameChange: false)
    }
    private func reader(size: CGSize = CGSize(width: 375, height: 667)) async -> WKWebView {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: config)
        loaded = expectation(description: "Offline phone document")
        web.navigationDelegate = self
        web.loadHTMLString("<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body></body></html>", baseURL: origin)
        let result = await XCTWaiter.fulfillment(of: [loaded!], timeout: 20)
        XCTAssertEqual(result, .completed)
        return web
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded?.fulfill(); loaded = nil }

    func testFeatureDeepLinksRetainQueriesAndRejectUntrustedOrNonPageDestinations() throws {
        for raw in ["/course?course=circuits", "/knowledge?course=signals&point=fourier#applications", "/development/collections/workbench/event-42", "/settings.html/", "/development/information/proposals/p-42"] {
            let url = URL(string: raw, relativeTo: origin)!.absoluteURL
            let destination = try XCTUnwrap(FeatureDestination(url: url, origin: origin), raw)
            XCTAssertEqual(destination.path, url.absoluteString)
        }
        for raw in ["https://attacker.test/settings", "http://www.free-bbs.cn/settings", "https://user:secret@www.free-bbs.cn/settings", "https://www.free-bbs.cn:444/settings", "/api/auth/me", "/uploads/private.png", "/development/unknown", "/development/collections/../admin", "/development/collections/%2e%2e/admin"] {
            let url = URL(string: raw.hasPrefix("/") ? origin.absoluteString + raw : raw)!
            XCTAssertFalse(FeatureCatalog.pageURL(url, origin: origin), raw)
        }
        XCTAssertEqual(FeatureCatalog.canonicalPath("/settings.html/"), "/settings")
        XCTAssertEqual(FeatureCatalog.canonicalPath("/circuit.html"), "/circuit")
        let circuit = try XCTUnwrap(FeatureDestination(url: URL(string: "/circuit.html?cid=c_0123456789abcdef01234567&revision=2", relativeTo: origin)!.absoluteURL, origin: origin))
        XCTAssertEqual(URLComponents(string: circuit.lab.path)?.path, "/circuit")
        XCTAssertEqual(URLComponents(string: circuit.lab.path)?.queryItems?.first?.value, "c_0123456789abcdef01234567")
        let management = try XCTUnwrap(FeatureCatalog.entries.first { $0.path == "/system-settings" })
        XCTAssertFalse(FeatureCatalog.visible(management, user: nil))
        XCTAssertFalse(FeatureCatalog.visible(management, user: user("student")))
        XCTAssertTrue(FeatureCatalog.visible(management, user: user("admin", admin: true)))
    }

    func testPreferencesPersistAcrossLaunchWithoutTokensAndStayAccountScoped() throws {
        let suite = "freebbs-feature-test-" + UUID().uuidString
        let preferences = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let store = AppStore(api: APIClient(origin: origin), preferences: preferences)
        store.user = user("alice:学习")
        let discoveryKey = WebPreferences.discoveryKey(store.user!)
        XCTAssertEqual(discoveryKey, "free_bbs_discovery:v1:alice%3A%E5%AD%A6%E4%B9%A0")
        store.saveWebPreference("free_bbs_theme_mode", value: "light")
        store.saveWebPreference(discoveryKey, value: "{\"kinds\":[\"knowledge\"]}")
        let draftKey = "free_bbs_lab_draft:alice:学习:python"
        store.saveWebPreference(draftKey, value: "{\"source\":\"print(7)\"}")
        store.saveWebPreference("free_bbs_max_model_v1:alice:学习", value: "{\"model\":\"chosen\"}")
        store.saveWebPreference("freebbs_ranch_study", value: "{\"musicEnabled\":false}")
        store.saveWebPreference("free_bbs_lab_draft:bob:python", value: "other-account")
        store.saveWebPreference("free_bbs_auth_token", value: "must-not-persist")
        store.saveWebPreference("campus_password", value: "must-not-persist")
        store.saveWebPreference("free_bbs_course_progress_v1", value: String(repeating: "x", count: 65537))
        XCTAssertEqual(store.webPreferenceValues.count, 5)
        let restored = AppStore(api: APIClient(origin: origin), preferences: preferences)
        restored.user = user("alice:学习")
        XCTAssertEqual(restored.webPreferenceValues[discoveryKey], store.webPreferenceValues[discoveryKey])
        XCTAssertEqual(restored.webPreferenceValues[draftKey], "{\"source\":\"print(7)\"}")
        XCTAssertNil(restored.webPreferenceValues["free_bbs_lab_draft:bob:python"])
        XCTAssertEqual(preferences.string(forKey: "freebbs.native.theme"), "light")
        restored.user = user("bob")
        XCTAssertTrue(restored.webPreferenceValues.isEmpty)
        XCTAssertFalse(WebPreferences.permits(discoveryKey, user: restored.user))
        XCTAssertNil(preferences.string(forKey: "freebbs.native.theme"))
        let previousStore = restored.featureDataStore
        XCTAssertFalse(previousStore.isPersistent)
        restored.logout()
        XCTAssertFalse(restored.featureDataStore === previousStore)
        XCTAssertNil(restored.api.token)
        restored.user = user("alice:学习")
        XCTAssertEqual(restored.webPreferenceValues["free_bbs_theme_mode"], "light")
    }

    func testReadingPreferencesAcceptOnlyWebsitePresets() {
        let style = ReadingStyle(raw: #"{"fontPreset":"zhongsong-study","typeScale":"large"}"#)
        XCTAssertEqual(style.scale, 1.18)
        XCTAssertTrue(style.bodyFamily.contains("Songti"))
        let invalid = ReadingStyle(raw: #"{"fontPreset":"';alert(1);//","typeScale":"999"}"#)
        XCTAssertEqual(invalid, ReadingStyle(raw: nil))
        XCTAssertFalse(invalid.bodyFamily.contains("alert"))
    }
    func testFeatureCatalogHasRenderablePhoneIcons() {
        for feature in FeatureCatalog.entries { XCTAssertNotNil(UIImage(systemName: feature.symbol), feature.path + ": " + feature.symbol) }
    }

    func testUploadCopiesProviderFilesAndResolvesCancellationExactlyOnce() throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("FeatureTest-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: source) }
        var inputs: [URL] = []
        for index in 0..<2 {
            let folder = source.appendingPathComponent(String(index))
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent("same.txt")
            try Data(String(index).utf8).write(to: url); inputs.append(url)
        }
        let browser = LabBrowserState()
        var replies = 0, copied: [URL] = []
        browser.fileReply = { replies += 1; copied = $0 ?? [] }
        let revision = browser.fileRevision
        browser.importFiles(inputs)
        defer { SiteImports.discard(copied) }
        XCTAssertEqual(replies, 1)
        XCTAssertNotEqual(browser.fileRevision, revision)
        XCTAssertEqual(copied.count, 2)
        XCTAssertNotEqual(copied.first, copied.last)
        XCTAssertEqual(try Data(contentsOf: copied[0]), Data("0".utf8))
        XCTAssertEqual(try Data(contentsOf: copied[1]), Data("1".utf8))
        browser.resolveFiles(nil)
        XCTAssertEqual(replies, 1)
        var consent: [Bool] = []
        browser.consentReplies = [{ consent.append($0) }, { consent.append($0) }]
        browser.resolveConsent(false); browser.resolveConsent(true)
        XCTAssertEqual(consent, [false, false])
    }

    func testAuthorizationAcceptsOnlyHTTPSAndExactCallbackWithOneConnector() {
        XCTAssertTrue(ConnectorAuthorizationPolicy.permits(URL(string: "https://id.tsinghua.edu.cn/authorize?state=once")!))
        for raw in ["http://id.tsinghua.edu.cn", "javascript:alert(1)", "https://user:password@id.tsinghua.edu.cn"] {
            XCTAssertFalse(ConnectorAuthorizationPolicy.permits(URL(string: raw)!))
        }
        let callback = URL(string: "/workbench?connector=tsinghua&result=connected", relativeTo: origin)!.absoluteURL
        XCTAssertTrue(ConnectorAuthorizationPolicy.isCallback(callback, origin: origin))
        for raw in ["https://attacker.test/workbench?connector=tsinghua", "/workbench?connector=tsinghua&connector=other", "/settings?connector=tsinghua", "/workbench"] {
            XCTAssertFalse(ConnectorAuthorizationPolicy.isCallback(URL(string: raw, relativeTo: origin)!.absoluteURL, origin: origin))
        }
    }
    func testDevelopmentEmbeddedSettingsCanUploadButUntrustedFramesCannotUseBridge() {
        let top = URL(string: "/development/settings", relativeTo: origin)!.absoluteURL
        XCTAssertTrue(FeatureWebPolicy.trustedEmbeddedPage(URL(string: "/settings?embed=development", relativeTo: origin)!.absoluteURL, top: top, origin: origin))
        for raw in ["/settings", "/settings?embed=development&embed=other", "/aichat?embed=development", "/uploads/tool.html?embed=development", "https://attacker.test/settings?embed=development"] {
            XCTAssertFalse(FeatureWebPolicy.trustedEmbeddedPage(URL(string: raw, relativeTo: origin)!.absoluteURL, top: top, origin: origin))
        }
        XCTAssertFalse(FeatureWebPolicy.trustedEmbeddedPage(URL(string: "/settings?embed=development", relativeTo: origin)!.absoluteURL, top: origin.appendingPathComponent("discussion"), origin: origin))
    }
    func testSessionRestoresPreferencesOnceAndRetainsLaterChangesAcrossDocuments() async throws {
        let web = await reader()
        let result = try await web.callAsyncJavaScript("""
            const values={};
            const storageClass=()=>class {getItem(key){return values[key] ?? null}setItem(key,value){values[key]=String(value)}removeItem(key){delete values[key]}};
            const location={origin:'https://www.free-bbs.cn',pathname:'/settings',href:'https://www.free-bbs.cn/settings'};
            const mock=()=>({fetch:async()=>new Response('{}'),webkit:{messageHandlers:{site:{postMessage:async()=>true}}}});
            const firstClass=storageClass(),first=new firstClass();
            Function('location','window','Storage','localStorage',script)(location,mock(),firstClass,first);
            first.setItem('free_bbs_theme_mode','dark');first.removeItem('free_bbs_typography_preferences');
            const nextClass=storageClass(),next=new nextClass();
            Function('location','window','Storage','localStorage',script)(location,mock(),nextClass,next);
            return {theme:next.getItem('free_bbs_theme_mode'),reading:next.getItem('free_bbs_typography_preferences'),seed:next.getItem('freebbs_native_preferences_seeded')};
            """, arguments: ["script":FeatureWebPolicy.session(origin: origin, token: "token", dark: false, preferences: ["free_bbs_theme_mode":"light", "free_bbs_typography_preferences":"old-reading-style"])], in: nil, contentWorld: .page)
        let values = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(values["theme"] as? String, "dark")
        XCTAssertTrue(values["reading"] is NSNull)
        XCTAssertEqual(values["seed"] as? String, "1")
    }

    func testActualSessionScriptGatesAIAndBridgesPreferencesWithoutNetwork() async throws {
        let web = await reader()
        let value = try await web.callAsyncJavaScript("""
            class FakeStorage { constructor(){this.values={}} getItem(key){return this.values[key] ?? null} setItem(key,value){this.values[key]=String(value)} removeItem(key){delete this.values[key]} }
            const storage = new FakeStorage(), events=[], requests=[], signals=[];
            let consent = false;
            const mock = {webkit:{messageHandlers:{site:{postMessage:async body=>{events.push(body);return body.type==='consent' ? consent : true}}}},
              fetch:async (input,options)=>{requests.push(String(input));if(options?.signal)signals.push(options.signal);return new Response('{"authorizationUrl":"https://id.tsinghua.edu.cn/authorize?state=once"}',{status:200})}};
            const location = {origin:'https://www.free-bbs.cn',href:'https://www.free-bbs.cn/workbench',pathname:'/workbench'};
            Function('location','window','Storage','localStorage',script)(location,mock,FakeStorage,storage);
            let denied='';try{await mock.fetch('/api/ai/chat',{method:'POST',body:'private-question'})}catch(error){denied=error.name}
            const deniedCount=requests.length;
            await mock.fetch('/api/ai/models');await mock.fetch('/api/discussion/posts',{method:'POST'});
            await mock.fetch('/api/ai/dialogs/d1',{method:'DELETE'});await mock.fetch('/api/ai/tasks/t1/cancel',{method:'POST'});
            const browsingConsent=events.filter(e=>e.type==='consent').length;
            consent=true;await mock.fetch('/api/ai/chat',{method:'POST'});
            const caller=new AbortController();await mock.fetch('/api/tools/generate/html',{method:'POST',signal:caller.signal});caller.abort();
            await mock.fetch('/api/workbench/schedule-planner/preview',{method:'POST'});
            mock.freebbsNativeCancelAI();
            storage.setItem('free_bbs_theme_mode','dark');storage.setItem('free_bbs_theme_mode','dark');
            storage.setItem('campus_password','not-forwarded');storage.setItem('free_bbs_auth_token','changed-token');storage.removeItem('free_bbs_auth_token');
            await mock.fetch('/api/profile',{method:'PATCH'});
            await mock.fetch('/api/workbench/connectors/tsinghua/authorization-attempts',{method:'POST'});
            return {denied,deniedCount,browsingConsent,cancelled:signals.every(s=>s.aborted),aiRequests:signals.length,
              preferences:events.filter(e=>e.type==='preference').map(e=>e.key),sessions:events.filter(e=>e.type==='session').map(e=>e.token),
              logout:events.filter(e=>e.type==='logout').length,profile:events.filter(e=>e.type==='profileChanged').length,
              authorization:events.find(e=>e.type==='authorization')?.url};
            """, arguments: ["script":FeatureWebPolicy.session(origin: origin, token: "initial-token", dark: false)], in: nil, contentWorld: .page)
        let result = try XCTUnwrap(value as? [String: Any])
        XCTAssertEqual(result["denied"] as? String, "AbortError")
        XCTAssertEqual(result["deniedCount"] as? Int, 0)
        XCTAssertEqual(result["browsingConsent"] as? Int, 1)
        XCTAssertEqual(result["cancelled"] as? Bool, true)
        XCTAssertEqual(result["aiRequests"] as? Int, 3)
        XCTAssertEqual(result["preferences"] as? [String], ["free_bbs_theme_mode"])
        XCTAssertEqual(result["sessions"] as? [String], ["changed-token"])
        XCTAssertEqual(result["logout"] as? Int, 1)
        XCTAssertEqual(result["profile"] as? Int, 1)
        XCTAssertEqual(result["authorization"] as? String, "https://id.tsinghua.edu.cn/authorize?state=once")
    }

    func testActualSessionScriptNeverInjectsIntoExternalOrUnknownPages() async throws {
        let web = await reader()
        let result = try await web.callAsyncJavaScript("""
            let writes=0;
            const storage={setItem:()=>writes++,removeItem:()=>writes++}, mock={};
            for(const location of [{origin:'https://attacker.test',pathname:'/settings'}, {origin:'https://www.free-bbs.cn',pathname:'/api/auth/me'}]) {
              Function('location','window','localStorage',script)(location,mock,storage);
            }
            return {writes,injected:document.documentElement.classList.contains('freebbs-native-feature')};
            """, arguments: ["script":FeatureWebPolicy.session(origin: origin, token: "secret", dark: false)], in: nil, contentWorld: .page)
        let values = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(values["writes"] as? Int, 0)
        XCTAssertEqual(values["injected"] as? Bool, false)
    }

    func testPhoneWorkspaceKeepsFormsDialogsAndWideTablesUsable() async throws {
        let web = await reader()
        let result = try await web.callAsyncJavaScript("""
            document.documentElement.classList.add('freebbs-native-feature');
            document.body.classList.add('has-mobile-header');
            document.head.insertAdjacentHTML('beforeend','<style>.settings-grid{display:grid;grid-template-columns:400px 400px}html body.has-mobile-header .topbar{display:flex!important}table{width:900px}input,button{height:20px;font-size:12px}</style>');
            document.body.innerHTML='<header class="topbar">duplicate header</header><div class="page-shell"><main class="main-content"><div class="settings-grid"><section><input value="editable"><input type="hidden" value="keep-hidden"><button id="save">保存</button></section><section>Settings</section></div><dialog><button>确认</button></dialog></main></div>';
            eval(script);
            document.body.classList.add('has-mobile-header');
            document.head.insertAdjacentHTML('beforeend','<style>body:not(.auth-page-body) .mobile-nav.mobile-nav-compact{display:flex!important}</style>');
            document.body.insertAdjacentHTML('beforeend','<nav class="mobile-nav mobile-nav-compact">late tabs</nav>');
            document.querySelector('main').insertAdjacentHTML('beforeend','<table><tr><td>large table</td></tr></table>');
            await new Promise(resolve=>setTimeout(resolve,80));
            const input=document.querySelector('input:not([type=hidden])'),dialog=document.querySelector('dialog');dialog.showModal();
            return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector('.settings-grid')).gridTemplateColumns.split(' ').length,
              duplicate:getComputedStyle(document.querySelector('.topbar')).display,button:document.getElementById('save').getBoundingClientRect().height,
              input:input.getBoundingClientRect().height,font:getComputedStyle(input).fontSize,hidden:getComputedStyle(document.querySelector('[type=hidden]')).display,
              lateNavigation:getComputedStyle(document.querySelector('.mobile-nav')).display,scroll:getComputedStyle(document.querySelector('.native-table-scroll')).overflowX,dialog:dialog.open};
            """, arguments: ["script":FeatureWebPolicy.mobile], in: nil, contentWorld: .page)
        let values = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(values["width"] as? Int, 375)
        XCTAssertLessThanOrEqual(try XCTUnwrap(values["pageWidth"] as? Int), 375)
        XCTAssertEqual(values["columns"] as? Int, 1)
        XCTAssertEqual(values["duplicate"] as? String, "none")
        XCTAssertEqual(values["lateNavigation"] as? String, "none")
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(values["button"] as? Double), 44)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(values["input"] as? Double), 44)
        XCTAssertEqual(values["font"] as? String, "16px")
        XCTAssertEqual(values["hidden"] as? String, "none")
        XCTAssertEqual(values["scroll"] as? String, "auto")
        XCTAssertEqual(values["dialog"] as? Bool, true)
    }
    func testFullScreenRanchSceneRemovesDesktopInsetsInBothOrientations() async throws {
        for size in [CGSize(width: 375, height: 667), CGSize(width: 667, height: 375)] {
            let web = await reader(size: size)
            let result = try await web.callAsyncJavaScript("""
                document.documentElement.classList.add('freebbs-native-feature');document.body.className='ranch-gallery-page';
                document.head.insertAdjacentHTML('beforeend','<style>body.ranch-gallery-page:not(.auth-page-body) .main-content.ranch-community-main{position:fixed;inset:112px 0 64px;width:auto!important;padding:0!important}.community-heading{position:absolute;top:94px}</style>');
                document.body.innerHTML='<div class="page-shell"><main class="main-content ranch-community-main"><section class="community-pasture"><header class="community-heading">Interactive scene</header></section></main></div>';
                eval(script);await new Promise(resolve=>setTimeout(resolve,50));
                const main=document.querySelector('main').getBoundingClientRect();
                return {top:main.top,bottom:main.bottom,height:innerHeight,headingTop:parseFloat(getComputedStyle(document.querySelector('.community-heading')).top)};
                """, arguments: ["script":FeatureWebPolicy.mobile], in: nil, contentWorld: .page)
            let values = try XCTUnwrap(result as? [String: Any])
            XCTAssertEqual(try XCTUnwrap(values["top"] as? Double), 0, accuracy: 1)
            XCTAssertEqual(try XCTUnwrap(values["bottom"] as? Double), try XCTUnwrap(values["height"] as? Double), accuracy: 1)
            XCTAssertEqual(values["headingTop"] as? Double, 16)
        }
    }
}
