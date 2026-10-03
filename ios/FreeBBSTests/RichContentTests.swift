import XCTest
import WebKit
@testable import FreeBBS

@MainActor
final class RichContentTests: XCTestCase, WKNavigationDelegate {
    private var loaded: XCTestExpectation?
    private let origin = URL(string: "https://www.free-bbs.cn")!
    private func reader() async -> WKWebView {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 600), configuration: config)
        web.navigationDelegate = self
        let ready = XCTestExpectation(description: "Offline renderer loaded")
        loaded = ready
        web.loadHTMLString(RichContentEngine.document, baseURL: origin)
        let result = await XCTWaiter.fulfillment(of: [ready], timeout: 20)
        XCTAssertEqual(result, .completed)
        return web
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded?.fulfill(); loaded = nil }
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
