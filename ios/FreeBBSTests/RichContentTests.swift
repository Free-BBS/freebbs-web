import XCTest
import WebKit
import SwiftUI
@testable import FreeBBS

@MainActor
final class RichContentTests: XCTestCase, WKNavigationDelegate {
    private var loaded: XCTestExpectation?
    private let origin = URL(string: "https://www.free-bbs.cn")!
    private func reader(size: CGSize = CGSize(width: 320, height: 600)) async -> WKWebView {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: config)
        web.navigationDelegate = self
        let ready = XCTestExpectation(description: "Offline renderer loaded")
        loaded = ready
        web.loadHTMLString(RichContentEngine.document, baseURL: origin)
        let result = await XCTWaiter.fulfillment(of: [ready], timeout: 20)
        XCTAssertEqual(result, .completed)
        return web
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded?.fulfill(); loaded = nil }
    func testProductionReaderLoadsBundledDocumentAndRecoversItsBody() async throws {
        var measuredHeight = 48.0
        // SwiftUI can retain the previous ready state when an account/session
        // change replaces only the representable's identity.
        var state = RichContentLoadState.ready
        var openedLinks: [String] = []
        let source = "## 实际正文\n\n$E=mc^2$\n\n| 时间 | 电压 |\n| --- | --- |\n| 0 | 1 |"
        let reader = RichWebView(source: source, origin: origin, token: nil, dark: false, fontSize: 17,
            allowReferences: false, height: Binding(get: { measuredHeight }, set: { measuredHeight = $0 }),
            readingStyle: ReadingStyle(raw: nil), loadState: Binding(get: { state }, set: { state = $0 }),
            link: { openedLinks.append($0) }, copy: { _ in })
        let coordinator = reader.makeCoordinator()
        // Exercise the actual delegate and sizing bridge, including creation
        // at zero size followed by SwiftUI's first real layout.
        let web = reader.makeWebView(coordinator: coordinator)
        web.frame = CGRect(x: 0, y: 0, width: 320, height: 48)
        defer {
            coordinator.invalidate(); web.stopLoading(); web.navigationDelegate = nil
            web.configuration.userContentController.removeScriptMessageHandler(forName: "reader")
        }
        for recovery in 0..<2 {
            let deadline = Date().addingTimeInterval(20)
            while Date() < deadline && (state != .ready || measuredHeight <= 100) {
                try await Task.sleep(for: .milliseconds(100))
            }
            XCTAssertEqual(state, .ready)
            XCTAssertGreaterThan(measuredHeight, 100)
            XCTAssertEqual(web.url?.standardizedFileURL, RichContentEngine.documentURL?.standardizedFileURL)
            let body = try await web.evaluateJavaScript("document.getElementById('content').textContent") as? String
            XCTAssertTrue(body?.contains("实际正文") == true)
            let math = try await web.evaluateJavaScript("document.querySelectorAll('.katex').length") as? Int
            XCTAssertEqual(math, 1)
            XCTAssertTrue(openedLinks.isEmpty, "The trusted document must load rather than become a navigation link")
            if recovery == 0 {
                measuredHeight = 48
                coordinator.webViewWebContentProcessDidTerminate(web)
            }
        }
    }
    func testOfflineFormulaTableCodeAndImages() async throws {
        let web = await reader()
        let source = "## 实验\n\n$E=mc^2$\n\n$$\\int_0^1 x^2 dx$$\n\n| 时间 | 电压 |\n| --- | --- |\n| 0 | 1 |\n\n```python\nprint(1 + 2)\n```\n\n![波形](/uploads/native-test-wave.png)"
        let value = try await web.callAsyncJavaScript("""
            renderNativeContent(source, origin, '', false, 17, false);
            return {math:document.querySelectorAll('.katex').length, tables:document.querySelectorAll('.table-scroll table').length,
              highlighted:!!document.querySelector('code[data-highlighted]'), image:document.querySelector('img')?.getAttribute('src'),
              font:!!document.querySelector('style').textContent.includes('data:font/woff2')};
            """, arguments: ["source":source, "origin":origin.absoluteString], in: nil, contentWorld: .page)
        let result = try XCTUnwrap(value as? [String:Any])
        XCTAssertEqual(result["math"] as? Int, 2)
        XCTAssertEqual(result["tables"] as? Int, 1)
        XCTAssertEqual(result["highlighted"] as? Bool, true)
        XCTAssertEqual(result["font"] as? Bool, true)
        XCTAssertEqual(result["image"] as? String, "https://www.free-bbs.cn/uploads/native-test-wave.png")
    }
    func testUntrustedMarkdownCannotExecuteScriptsOrLoadFrames() async throws {
        let web = await reader()
        let source = "<script>window.compromised=true</script>\n\n<img src='javascript:alert(1)' onerror='window.compromised=true'>\n\n<iframe src='https://attacker.test'></iframe>\n\n[x](javascript:alert(1))\n\n![x](http://attacker.test/x)\n\n$\\href{javascript:alert(1)}{click}$"
        let value = try await web.callAsyncJavaScript("""
            renderNativeContent(source, origin, 'test-secret', true, 24, false);
            return {compromised:!!window.compromised, scripts:document.querySelectorAll('#content script').length,
              frames:document.querySelectorAll('#content iframe').length, events:document.querySelectorAll('#content [onerror]').length,
              unsafe:document.querySelectorAll('#content [href^="javascript:"],#content [src^="http:"],#content [src^="javascript:"]').length};
            """, arguments: ["source":source,"origin":origin.absoluteString], in: nil, contentWorld: .page)
        let result = try XCTUnwrap(value as? [String:Any])
        XCTAssertEqual(result["compromised"] as? Bool, false)
        for key in ["scripts","frames","events","unsafe"] { XCTAssertEqual(result[key] as? Int, 0, key) }
    }
    func testPublishedToolUsesOpaqueSandbox() async throws {
        let web = await reader()
        let result = try await web.callAsyncJavaScript("""
            window.privateMarker='host-secret';
            return await new Promise(resolve => {
              const frame=document.createElement('iframe'); frame.setAttribute('sandbox','allow-scripts');
              const timer=setTimeout(()=>resolve('timeout'),3000);
              window.addEventListener('message',event=>{
                if(event.source===frame.contentWindow) {clearTimeout(timer); resolve(event.data);}
              });
              frame.srcdoc=FreeBbsToolEmbeds.sandboxDocument('<script>let result;try{result=parent.privateMarker}catch{result="isolated"}parent.postMessage(result,"*")<\\/script>',true);
              document.getElementById('content').append(frame);
            });
            """, arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(result as? String, "isolated")
    }
    func testLabShellRemovesSpecificAndLateWebsiteNavigation() async throws {
        let web = await reader()
        let value = try await web.callAsyncJavaScript("""
            document.body.classList.add('has-mobile-header');
            const css=document.createElement('style');
            css.textContent='html body.has-mobile-header .topbar, body:not(.auth-page-body) .mobile-nav.mobile-nav-compact { display:flex!important; }';
            document.head.append(css);
            document.body.insertAdjacentHTML('beforeend','<header class="topbar">site header</header><nav class="mobile-nav mobile-nav-compact">site tabs</nav>');
            eval(script);
            document.body.insertAdjacentHTML('beforeend','<div class="mobile-header-backdrop">late backdrop</div>');
            await new Promise(resolve=>setTimeout(resolve,50));
            return [...document.querySelectorAll('.topbar,.mobile-nav,.mobile-header-backdrop')].map(node=>getComputedStyle(node).display);
            """, arguments: ["script":WebContentPolicy.mobileScript], in: nil, contentWorld: .page)
        XCTAssertEqual(value as? [String], ["none","none","none"])
    }
    func testNativeCircuitUsesEntirePortraitAndLandscapeViewportWithoutStretchingSymbols() async throws {
        for size in [CGSize(width: 320, height: 600), CGSize(width: 1024, height: 400)] {
            // Give each WebKit document its real viewport at load time; an offscreen
            // view resized after navigation can retain the previous CSS dvh on iOS 26.
            let web = await reader(size: size)
            let value = try await web.callAsyncJavaScript("""
                document.body.className='circuit-page has-circuit-mobile-workspace';
                document.body.innerHTML='<div class="page-shell"><main class="circuit-main"><section class="circuit-workspace"><div class="circuit-canvas-panel"><div class="circuit-stage"><svg viewBox="0 0 1000 640"><rect width="1000" height="640"/><path data-grid-size="20"/><g data-component-id="test-part" transform="translate(180 140)"><rect x="-50" y="-20" width="100" height="40"/></g></svg></div></div></section></main></div><dialog><div class="circuit-palette">元件列表</div></dialog>';
                const old=document.createElement('style');
                old.textContent='body.has-circuit-mobile-workspace .page-shell > .circuit-main {position:fixed!important;inset:112px 0 64px!important} body.has-circuit-mobile-workspace .page-shell .circuit-canvas-panel {position:absolute!important;inset:44px 0 122px!important}';
                document.head.append(old);
                eval(viewport); eval(script);
                await new Promise(resolve=>setTimeout(resolve,80));
                const main=document.querySelector('main').getBoundingClientRect();
                const canvas=document.querySelector('.circuit-stage').getBoundingClientRect();
                const svg=document.querySelector('svg');
                const controls=Object.fromEntries(['in','out','reset','pan','value','expand'].map(key=>[key,document.createElement('button')]));
                const stage=document.querySelector('.circuit-stage');stage.style.display='none';
                const initialPart=svg.querySelector('[data-component-id]');initialPart.remove();
                const camera=FreeBbsCircuitViewport.create(stage,controls);camera.attach();const initialZoom=controls.value.textContent;
                stage.style.display='';svg.append(initialPart);camera.attach();
                await new Promise(resolve=>setTimeout(resolve,80));
                const matrix=svg.getScreenCTM();const part=svg.querySelector('[data-component-id]').getBoundingClientRect();
                const dialog=document.querySelector('dialog');dialog.showModal();
                const result={initialZoom,top:main.top,bottom:main.bottom,canvasHeight:canvas.height,viewportHeight:innerHeight,
                  partVisible:part.left>=canvas.left && part.right<=canvas.right && part.top>=canvas.top && part.bottom<=canvas.bottom,
                  cameraFills:Math.abs(svg.viewBox.baseVal.width/svg.viewBox.baseVal.height-canvas.width/canvas.height)<0.001,
                  uniform:Math.abs(matrix.a-matrix.d)<0.0001,aspect:svg.getAttribute('preserveAspectRatio'),
                  sheetVisible:getComputedStyle(dialog.querySelector('.circuit-palette')).display!=='none',
                  mobileControls:matchMedia('(max-width: 900px)').matches};dialog.close();
                const fresh=svg.querySelector('[data-component-id]').cloneNode(true);fresh.dataset.componentId='new-part';fresh.setAttribute('transform','translate(900 600)');svg.append(fresh);camera.attach();
                const onCanvas=node=>{const r=node.getBoundingClientRect();return r.left>=canvas.left && r.right<=canvas.right && r.top>=canvas.top && r.bottom<=canvas.bottom;};
                result.newVisible=onCanvas(fresh);controls.reset.click();result.resetVisible=onCanvas(fresh);return result;
                """, arguments: ["script":WebContentPolicy.nativeCircuitScript,"viewport":WebContentPolicy.nativeViewportScript], in: nil, contentWorld: .page)
            let result = try XCTUnwrap(value as? [String:Any])
            XCTAssertEqual(try XCTUnwrap(result["top"] as? Double), 0, accuracy: 1)
            XCTAssertEqual(try XCTUnwrap(result["bottom"] as? Double), try XCTUnwrap(result["viewportHeight"] as? Double), accuracy: 1)
            XCTAssertEqual(try XCTUnwrap(result["canvasHeight"] as? Double), try XCTUnwrap(result["viewportHeight"] as? Double), accuracy: 1)
            XCTAssertEqual(result["uniform"] as? Bool, true)
            XCTAssertEqual(result["partVisible"] as? Bool, true)
            XCTAssertEqual(result["initialZoom"] as? String, "100%")
            XCTAssertEqual(result["cameraFills"] as? Bool, true)
            XCTAssertEqual(result["newVisible"] as? Bool, true)
            XCTAssertEqual(result["resetVisible"] as? Bool, true)
            XCTAssertEqual(result["aspect"] as? String, "xMidYMid meet")
            XCTAssertEqual(result["sheetVisible"] as? Bool, true)
            XCTAssertEqual(result["mobileControls"] as? Bool, true)
        }
    }
    func testNativeParameterSheetKeepsInputVisibleInLandscapeAndKeyboardSizedViewports() async throws {
        for size in [CGSize(width: 667, height: 220), CGSize(width: 375, height: 224)] {
            let web = await reader(size: size)
            let value = try await web.callAsyncJavaScript("""
                document.body.innerHTML='<div class="page-shell"><main class="circuit-main"><section class="circuit-parameter-popover"><header class="circuit-parameter-popover-heading"><div><p>元件参数</p><h3>R1 · 电阻</h3></div><button class="circuit-parameter-popover-close">×</button></header><form class="circuit-parameter-popover-fields"><p class="circuit-parameter-hint">支持字头：m、u、n、p，例如 4.7k。</p><label style="display:grid;gap:5px">电阻 / Ω<input value="1000"></label></form><footer class="circuit-parameter-popover-footer"><span>修改即保存到草稿</span><button class="circuit-parameter-popover-sidebar">在侧栏查看</button></footer></section></main></div>';
                const old=document.createElement('style');old.textContent='.circuit-parameter-popover{display:flex;flex-direction:column;position:fixed;height:auto}.circuit-parameter-popover-heading,.circuit-parameter-popover-footer{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between}.circuit-parameter-popover-fields{display:grid;flex:1 1 auto;grid-template-columns:minmax(0,1fr);gap:12px;overflow:auto}.circuit-parameter-popover-heading p,.circuit-parameter-popover-heading h3{margin:0}.circuit-parameter-popover-fields p{margin:0}';document.head.append(old);
                const stage=document.createElement('div');stage.id='circuit-stage';stage.className='circuit-stage';
                stage.innerHTML='<svg><g data-component-id="r1" transform="translate(3000 3000)"><rect width="40" height="20"/></g></svg>';
                document.querySelector('main').append(stage);
                eval(script);
                FreeBbsCircuitParameterPopover.show({componentId:'r1',title:'R1 · 电阻',editable:true,html:'<p class="circuit-parameter-hint">支持字头：m、u、n、p，例如 4.7k。</p><label style="display:grid;gap:5px">电阻 / Ω<input data-parameter="resistance" value="1000"></label>'});
                document.querySelector('input').focus();FreeBbsCircuitParameterPopover.reposition();
                await new Promise(resolve=>setTimeout(resolve,80));
                const sheet=document.querySelector('.circuit-parameter-popover').getBoundingClientRect();
                const form=document.querySelector('form').getBoundingClientRect(),input=document.querySelector('input').getBoundingClientRect();
                return {visible:!document.querySelector('.circuit-parameter-popover').hidden,contained:input.top>=form.top && input.bottom<=form.bottom && sheet.top>=0 && sheet.bottom<=innerHeight,readable:input.height>=44,scrollable:getComputedStyle(document.querySelector('form')).overflowY==='auto'};
                """, arguments: ["script":WebContentPolicy.nativeCircuitScript], in: nil, contentWorld: .page)
            let result = try XCTUnwrap(value as? [String:Any])
            XCTAssertEqual(result["visible"] as? Bool, true)
            XCTAssertEqual(result["contained"] as? Bool, true)
            XCTAssertEqual(result["readable"] as? Bool, true)
            XCTAssertEqual(result["scrollable"] as? Bool, true)
        }
    }
    func testNativeToolPreviewUsesSharedSandboxAndHasNoBridge() async throws {
        let web = await reader()
        _ = try await web.evaluateJavaScript("window.privateMarker='host-secret';window.previewResult='waiting';window.addEventListener('message',event=>window.previewResult=event.data)")
        let coordinator = ToolSandboxView.Coordinator()
        coordinator.ready = true
        coordinator.html = "<html><body><script>let value;try{value=parent.privateMarker}catch{value='isolated'}parent.postMessage(value,'*')</script></body></html>"
        coordinator.render(web)
        let value = try await web.callAsyncJavaScript("""
            for(let i=0;i<60 && window.previewResult==='waiting';i++) await new Promise(resolve=>setTimeout(resolve,50));
            const frame=document.querySelector('iframe');
            return {result:window.previewResult,sandbox:frame?.getAttribute('sandbox'),networkBlocked:frame?.srcdoc.includes("connect-src 'none'"),bridge:!!window.webkit?.messageHandlers?.reader};
            """, arguments: [:], in: nil, contentWorld: .page)
        let result = try XCTUnwrap(value as? [String:Any])
        XCTAssertEqual(result["result"] as? String, "isolated")
        XCTAssertEqual(result["sandbox"] as? String, "allow-scripts")
        XCTAssertEqual(result["networkBlocked"] as? Bool, true)
        XCTAssertEqual(result["bridge"] as? Bool, false)
    }
    func testOnlyExactHTTPSLabOriginsReceiveSessions() {
        for raw in ["https://attacker.test/circuit", "https://www.free-bbs.cn.attacker.test/circuit", "https://www.free-bbs.cn:444/circuit", "http://www.free-bbs.cn/circuit", "https://user:password@www.free-bbs.cn/circuit", "https://www.free-bbs.cn/profile", "https://www.free-bbs.cn/circuit/not-a-lab"] {
            XCTAssertFalse(WebContentPolicy.labURL(URL(string: raw)!, origin: origin), raw)
        }
        XCTAssertTrue(WebContentPolicy.labURL(URL(string: "https://www.free-bbs.cn/code-lab?language=python")!, origin: origin))
    }
}
