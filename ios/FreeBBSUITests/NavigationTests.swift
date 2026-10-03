import XCTest

@MainActor
final class NavigationTests: XCTestCase {
    private var app: XCUIApplication!
    private func launchPreview() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        addTeardownBlock { XCUIDevice.shared.orientation = .portrait }
        app = XCUIApplication()
        app.launchArguments = ["--demo", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.staticTexts["demoBanner"].waitForExistence(timeout: 15))
    }
    func testNativePagesAndCaptureReviewScreenshots() {
        launchPreview()
        capture("01-home")
        app.buttons["openMax"].tap()
        XCTAssertTrue(app.navigationBars["问问 Max"].waitForExistence(timeout: 5))
        capture("02-max")
        back()
        app.buttons["openWorkbench"].tap()
        XCTAssertTrue(app.staticTexts["信号与系统 · 卷积复习"].waitForExistence(timeout: 5))
        capture("03-workbench")
        back()
        app.tabBars.buttons["课程"].tap()
        app.staticTexts["信号与系统"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["卷积"].waitForExistence(timeout: 5))
        capture("04-course")
        app.staticTexts["卷积"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["知识点"].waitForExistence(timeout: 5))
        capture("05-knowledge")
        back()
        app.buttons["关系图"].tap()
        capture("06-map")
        app.tabBars.buttons["讨论"].tap()
        app.descendants(matching: .any).matching(identifier: "post-preview-convolution").firstMatch.tap()
        XCTAssertTrue(app.navigationBars["讨论详情"].waitForExistence(timeout: 5))
        capture("07-discussion-detail")
        back()
        app.buttons["composePost"].tap()
        XCTAssertTrue(app.navigationBars["发表讨论"].waitForExistence(timeout: 5))
        capture("08-compose")
        app.buttons["取消"].tap()
        app.tabBars.buttons["今日"].tap()
        app.buttons["openInbox"].tap()
        capture("09-inbox")
        app.buttons["全部已读"].tap()
        XCTAssertFalse(app.buttons["全部已读"].isEnabled)
        app.tabBars.buttons["我的"].tap()
        capture("10-profile")
        tapListText("帮助与联系")
        XCTAssertTrue(app.navigationBars["帮助与联系"].waitForExistence(timeout: 5))
        let support = app.descendants(matching: .any).matching(identifier: "contactSupport").firstMatch
        XCTAssertTrue(support.waitForExistence(timeout: 5))
        capture("11-support")
    }
    func testLandscapeAndLargeDynamicTypeRemainNavigable() {
        launchPreview()
        XCUIDevice.shared.orientation = .landscapeLeft
        app.tabBars.buttons["课程"].tap()
        let landscape = NSPredicate { _, _ in
            let size = XCUIScreen.main.screenshot().image.size
            return size.width > size.height
        }
        let ready = expectation(for: landscape, evaluatedWith: app)
        wait(for: [ready], timeout: 20)
        XCTAssertTrue(app.staticTexts["信号与系统"].waitForExistence(timeout: 5))
        capture("12-landscape")
        XCUIDevice.shared.orientation = .portrait
        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["课程"].waitForExistence(timeout: 10))
        app.tabBars.buttons["课程"].tap()
        XCTAssertTrue(app.staticTexts["信号与系统"].waitForExistence(timeout: 5))
        capture("13-accessibility-text")
        app.tabBars.buttons["我的"].tap()
        XCTAssertTrue(app.staticTexts["编辑个人资料"].exists)
    }
    func testAccountAndPolicyPages() {
        launchPreview()
        app.tabBars.buttons["我的"].tap()
        tapListText("编辑个人资料")
        capture("14-edit-profile")
        back()
        tapListText("修改用户名")
        capture("15-username")
        back()
        tapListText("修改密码")
        capture("16-password")
        back()
        tapListText("删除账号")
        capture("17-account-deletion")
        back()
        tapListText("隐私政策")
        capture("18-privacy")
        back()
        app.swipeUp()
        app.buttons["退出登录"].tap()
        app.sheets.buttons["退出登录"].tap()
        let login = revealProfileLogin()
        capture("18a-logged-out-profile")
        login.tap()
        XCTAssertTrue(app.textFields["loginIdentifier"].waitForExistence(timeout: 5))
        capture("19-login")
        app.buttons["注册"].tap()
        capture("20-registration")
        app.buttons["找回密码"].tap()
        capture("21-reset-password")
    }
    func testLaboratoriesAndThreadedReplies() {
        launchPreview()
        app.tabBars.buttons["实验室"].tap()
        XCTAssertTrue(app.staticTexts["电路实验室"].waitForExistence(timeout: 5))
        capture("22-laboratories")
        tapIdentifiedElement("lab-/circuits")
        // Section headers have different AX element types across iOS releases.
        // Check the destination and its real action instead of the header's type.
        XCTAssertTrue(app.navigationBars["电路实验室"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["新建电路"].waitForExistence(timeout: 15))
        capture("23-circuit-workspace")
        app.tabBars.buttons["讨论"].tap()
        capture("24-discussion-feed")
        app.descendants(matching: .any).matching(identifier: "post-preview-convolution").firstMatch.tap()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
        // Wait for the asynchronous Markdown body before locating replies below it.
        XCTAssertTrue(app.webViews.staticTexts["从滑动的窗口开始"].firstMatch.waitForExistence(timeout: 10))
        // Enter the replies before looking up their native controls. Whole-app
        // queries can stall while snapshotting offscreen WebKit accessibility trees.
        let detail = app.scrollViews["discussionDetailScroll"].firstMatch
        XCTAssertTrue(detail.waitForExistence(timeout: 10))
        detail.swipeUp(velocity: .slow)
        let target = detail.buttons.matching(identifier: "reply-to-1").firstMatch
        var tappedReply = false
        for _ in 0..<12 {
            if target.exists && target.isHittable { target.tap(); tappedReply = true; break }
            detail.swipeUp(velocity: .slow)
        }
        XCTAssertTrue(tappedReply, "The first reply must be reachable and tappable")
        // Verify the actual reply destination; a second hit-test can race a WebKit resize.
        XCTAssertTrue(app.staticTexts["回复 @campus_notes"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["取消回复"].exists)
        app.buttons["取消回复"].tap()
        capture("25-threaded-replies")
    }
    func testNativeCodeEditorAndToolPreview() {
        launchPreview()
        app.tabBars.buttons["实验室"].tap()
        app.descendants(matching: .any).matching(identifier: "lab-/code-lab?language=python").firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Python 实验"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["runLab"].isHittable)
        capture("26-native-python")
        app.buttons["editLabSource"].tap()
        XCTAssertTrue(app.textViews["labSourceEditor"].waitForExistence(timeout: 5))
        capture("27-native-editor")
        app.buttons["完成"].tap()
        back()
        tapIdentifiedElement("lab-/tool-workshop")
        XCTAssertTrue(app.navigationBars["工具工坊"].waitForExistence(timeout: 5))
        app.buttons["createTool"].tap()
        capture("28-native-tool-editor")
        app.buttons["previewTool"].tap()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.staticTexts["学习计时器"].firstMatch.waitForExistence(timeout: 30))
        capture("29-tool-preview")
    }
    func testDiscussionSortIsSelectable() {
        launchPreview()
        app.tabBars.buttons["讨论"].tap()
        let selector = app.segmentedControls["discussionSort"]
        XCTAssertTrue(selector.waitForExistence(timeout: 5))
        selector.buttons["热门"].tap()
        XCTAssertTrue(selector.buttons["热门"].isSelected)
        selector.buttons["最新"].tap()
        XCTAssertTrue(selector.buttons["最新"].isSelected)
        XCTAssertTrue(app.staticTexts["置顶"].exists)
        capture("30-latest-discussions")
    }
    func testCompleteFeatureCatalogSearchAndNavigation() {
        launchPreview()
        app.buttons["allFeatures"].tap()
        XCTAssertTrue(app.navigationBars["所有功能"].waitForExistence(timeout: 5))
        capture("40-all-features")
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("牧场\n")
        let ranch = app.descendants(matching: .any).matching(identifier: "feature-/ranch").firstMatch
        XCTAssertTrue(ranch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "feature-/system-settings").firstMatch.exists)
        capture("41-feature-search")
        tapIdentifiedElement("feature-/ranch")
        XCTAssertTrue(app.navigationBars["电子牧场"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["工作区预览"].waitForExistence(timeout: 5))
        capture("42-feature-workspace-preview")
        back(); back()
        app.tabBars.buttons["我的"].tap()
        tapListText("全部个人设置")
        XCTAssertTrue(app.navigationBars["全部个人设置"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["工作区预览"].exists)
    }
    func testMarkdownEditorSelectsCourseBeforeOpeningContextDocument() {
        launchPreview()
        app.buttons["allFeatures"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("Markdown\n")
        tapIdentifiedElement("feature-/markdown-editor")
        XCTAssertTrue(app.navigationBars["Markdown 编辑器"].waitForExistence(timeout: 5))
        let course = app.buttons["document-course-signals"].firstMatch
        XCTAssertTrue(course.waitForExistence(timeout: 5))
        XCTAssertTrue(course.isHittable)
        capture("43-document-course-selection")
        course.tap()
        XCTAssertTrue(app.navigationBars["信号与系统"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["文档选择预览"].exists)
    }
    func testMaxConsentSurvivesClearAndPageNavigationAndCanBeWithdrawn() {
        launchPreview()
        app.buttons["openMax"].tap()
        let consent = app.switches["maxConsent"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.tap()
        XCTAssertFalse(consent.exists)
        app.buttons["清空"].tap()
        XCTAssertFalse(consent.exists)
        back()
        app.buttons["openMax"].tap()
        XCTAssertTrue(app.navigationBars["问问 Max"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.switches["maxConsent"].exists)
        capture("31-max-consent-remembered")
        app.tabBars.buttons["我的"].tap()
        let setting = app.descendants(matching: .any).matching(identifier: "maxConsentSetting").firstMatch
        for _ in 0..<10 {
            if setting.exists && setting.isHittable { break }
            app.swipeUp(velocity: .slow)
        }
        XCTAssertTrue(setting.isHittable)
        // A native List switch exposes the entire row as its accessibility frame.
        // Tap the trailing switch, keeping the label outside the hit target.
        setting.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        let withdrawn = expectation(for: NSPredicate(format: "value == %@", "0"), evaluatedWith: setting)
        wait(for: [withdrawn], timeout: 5)
        capture("32-max-consent-withdrawn")
        app.tabBars.buttons["今日"].tap()
        back()
        app.buttons["openMax"].tap()
        XCTAssertTrue(app.switches["maxConsent"].waitForExistence(timeout: 5))
    }
    private func tapIdentifiedElement(_ id: String) {
        let item = app.descendants(matching: .any).matching(identifier: id).firstMatch
        for _ in 0..<10 {
            if item.exists && item.isHittable { item.tap(); return }
            app.swipeUp(velocity: .slow)
        }
        XCTFail("Unable to reach element: " + id + "\n" + app.debugDescription)
    }
    private func back() { app.navigationBars.buttons.element(boundBy: 0).tap() }
    private func revealProfileLogin() -> XCUIElement {
        let item = app.buttons["profileLogin"]
        for _ in 0..<8 {
            var previousFrame: CGRect?
            var stationarySince: Date?
            let visible = NSPredicate { _, _ in
                guard item.exists else { return false }
                let frame = item.frame
                // iOS 27 can report a scrolling List row as hittable while its
                // synthesized tap falls under the navigation/status bars.
                guard frame.width > 0, frame.height > 0,
                      frame.minY >= self.app.navigationBars.firstMatch.frame.maxY,
                      frame.maxY <= self.app.tabBars.firstMatch.frame.minY else {
                    previousFrame = nil; stationarySince = nil
                    return false
                }
                guard item.isHittable else { return false }
                if previousFrame != frame {
                    previousFrame = frame; stationarySince = Date()
                    return false
                }
                return stationarySince.map { Date().timeIntervalSince($0) >= 0.3 } ?? false
            }
            let ready = XCTNSPredicateExpectation(predicate: visible, object: nil)
            if XCTWaiter.wait(for: [ready], timeout: 2) == .completed { return item }
            app.swipeDown(velocity: .slow)
        }
        XCTFail("Login row must settle inside the visible List content\n" + app.debugDescription)
        return item
    }
    private func tapListText(_ text: String) {
        let item = app.staticTexts[text]
        for _ in 0..<5 {
            if item.exists && item.isHittable { item.tap(); return }
            app.swipeUp()
        }
        XCTFail("Unable to reach list item: " + text)
    }
    private func capture(_ name: String) {
        // Capture the device, avoiding XCTest's application crop during rotation.
        let screenshot = XCUIScreen.main.screenshot()
        if name == "12-landscape" { XCTAssertGreaterThan(screenshot.image.size.width, screenshot.image.size.height) }
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
