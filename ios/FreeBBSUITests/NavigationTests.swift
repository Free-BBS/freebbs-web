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
    func testWebsiteBottomNavigationCurrencyAndDevelopmentExclusion() {
        launchPreview()
        for id in ["home", "discussion", "publish", "learning", "tools", "search"] { XCTAssertTrue(app.buttons["bottom-" + id].exists) }
        XCTAssertGreaterThan(app.buttons["bottom-search"].frame.minX, app.buttons["bottom-tools"].frame.maxX)
        XCTAssertTrue(app.staticTexts["电元"].exists)
        XCTAssertTrue(app.staticTexts["磁元"].exists)
        XCTAssertFalse(app.staticTexts["磁子"].exists)
        app.buttons["bottom-publish"].tap()
        XCTAssertTrue(app.buttons["menu-/publish"].exists)
        XCTAssertTrue(app.buttons["menu-/aichat"].exists)
        dismissPopup()
        app.buttons["bottom-learning"].tap()
        for path in ["/world", "/laboratory", "/creative-workshop"] { XCTAssertTrue(app.buttons["menu-" + path].exists) }
        capture("44-website-learning-navigation")
        dismissPopup()
        app.buttons["bottom-tools"].tap()
        for path in ["/workbench", "/pbl", "/surveys", "/settings"] { XCTAssertTrue(app.buttons["menu-" + path].exists) }
        XCTAssertFalse(app.buttons["menu-/development"].exists)
        capture("45-website-tools-navigation")
        dismissPopup()
        app.buttons["bottom-home"].tap()
        app.buttons["allFeatures"].tap()
        let search = app.searchFields.firstMatch
        search.tap(); search.typeText("发展端\n")
        // The system localizes this heading differently across iOS releases.
        // The empty-state heading still includes the submitted search term.
        let emptyHeading = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "发展端")).firstMatch
        XCTAssertTrue(emptyHeading.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["feature-/development"].exists)
        capture("46-development-excluded")
    }
    func testNativePagesAndCaptureReviewScreenshots() {
        launchPreview()
        capture("01-home")
        app.buttons["openMax"].tap()
        XCTAssertTrue(app.navigationBars["问问 Max"].waitForExistence(timeout: 5))
        capture("02-max")
        back()
        app.buttons["openWorkbench"].tap()
        XCTAssertTrue(app.buttons["addSchedule"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.webViews.firstMatch.exists)
        capture("03-workbench")
        back()
        openLearning("/world")
        app.staticTexts["信号与系统"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["卷积"].waitForExistence(timeout: 5))
        capture("04-course")
        app.staticTexts["卷积"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["知识点"].waitForExistence(timeout: 5))
        capture("05-knowledge")
        back()
        app.buttons["关系图"].tap()
        capture("06-map")
        app.buttons["bottom-discussion"].tap()
        app.descendants(matching: .any).matching(identifier: "post-preview-convolution").firstMatch.tap()
        XCTAssertTrue(app.navigationBars["讨论详情"].waitForExistence(timeout: 5))
        capture("07-discussion-detail")
        back()
        app.buttons["composePost"].tap()
        XCTAssertTrue(app.navigationBars["发表讨论"].waitForExistence(timeout: 5))
        capture("08-compose")
        app.buttons["取消"].tap()
        app.buttons["bottom-home"].tap()
        app.buttons["openInbox"].tap()
        capture("09-inbox")
        app.buttons["全部已读"].tap()
        XCTAssertFalse(app.buttons["全部已读"].isEnabled)
        openProfile()
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
        openLearning("/world")
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
        XCTAssertTrue(app.buttons["bottom-learning"].waitForExistence(timeout: 10))
        openLearning("/world")
        XCTAssertTrue(app.staticTexts["信号与系统"].waitForExistence(timeout: 5))
        capture("13-accessibility-text")
        openProfile()
        XCTAssertTrue(app.staticTexts["编辑个人资料"].exists)
    }
    func testAccountAndPolicyPages() {
        launchPreview()
        openProfile()
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
        // Use the visible row's center: iOS 27's List AX activation point can
        // remain beneath the status bar even after the row has scrolled back.
        login.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.textFields["loginIdentifier"].waitForExistence(timeout: 5))
        capture("19-login")
        app.buttons["注册"].tap()
        capture("20-registration")
        app.buttons["找回密码"].tap()
        capture("21-reset-password")
    }
    func testLaboratoriesAndThreadedReplies() {
        launchPreview()
        openLearning("/laboratory")
        XCTAssertTrue(app.staticTexts["电路实验室"].waitForExistence(timeout: 5))
        capture("22-laboratories")
        tapIdentifiedElement("lab-/circuits")
        // Section headers have different AX element types across iOS releases.
        // Check the destination and its real action instead of the header's type.
        XCTAssertTrue(app.navigationBars["电路实验室"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["新建电路"].waitForExistence(timeout: 15))
        capture("23-circuit-workspace")
        app.buttons["bottom-discussion"].tap()
        capture("24-discussion-feed")
        app.descendants(matching: .any).matching(identifier: "post-preview-convolution").firstMatch.tap()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
        // WebKit first appears as a 48-point host. Wait for Markdown's native
        // measured height to settle before requesting its deep AX subtree;
        // snapshotting while it is being replaced can stall on slow runners.
        let bodyDeadline = Date().addingTimeInterval(30)
        var previousBodyFrame: CGRect?
        var bodySettled = false
        while Date() < bodyDeadline {
            let frame = app.webViews.firstMatch.frame
            if frame.height > 100, let previousBodyFrame,
               abs(frame.height - previousBodyFrame.height) <= 0.5,
               abs(frame.minY - previousBodyFrame.minY) <= 0.5 {
                bodySettled = true; break
            }
            previousBodyFrame = frame
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTAssertTrue(bodySettled, "Markdown must finish its initial native layout before reading replies")
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
        openLearning("/laboratory")
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
        app.buttons["bottom-discussion"].tap()
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
        XCTAssertTrue(app.buttons["牧场操作"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["牧场学习"].exists)
        capture("42-feature-workspace-preview")
        back(); back()
        openProfile()
        XCTAssertTrue(app.navigationBars["个人设置"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["chooseAvatar"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
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
        app.buttons["新对话"].tap()
        XCTAssertFalse(consent.exists)
        back()
        app.buttons["openMax"].tap()
        XCTAssertTrue(app.navigationBars["问问 Max"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.switches["maxConsent"].exists)
        capture("31-max-consent-remembered")
        openProfile()
        let setting = revealVisibleListControl(app.switches["maxConsentSetting"])
        capture("31a-max-consent-setting-visible")
        // A native List switch exposes the entire row as its accessibility frame.
        // Tap the trailing switch, keeping the label outside the hit target.
        setting.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        let withdrawn = expectation(for: NSPredicate(format: "value == %@", "0"), evaluatedWith: setting)
        wait(for: [withdrawn], timeout: 5)
        capture("32-max-consent-withdrawn")
        app.buttons["bottom-home"].tap()
        app.buttons["openMax"].tap()
        XCTAssertTrue(app.switches["maxConsent"].waitForExistence(timeout: 5))
    }
    private func openLearning(_ path: String) {
        returnToMenu("学习")
        tapMenuItem(path)
    }
    private func openProfile() {
        returnToMenu("工具")
        tapMenuItem("/settings")
    }
    private func returnToMenu(_ title: String) {
        let id = title == "学习" ? "learning" : "tools"
        let button = app.buttons["bottom-" + id]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
    }
    private func dismissPopup() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
    }
    private func tapMenuItem(_ path: String) {
        let item = app.buttons["menu-" + path]
        XCTAssertTrue(item.waitForExistence(timeout: 5), "Menu item missing: " + path)
        item.tap()
    }
    func testBottomRightSearchAndNativePublishPopup() {
        launchPreview()
        let search = app.buttons["bottom-search"]
        XCTAssertGreaterThan(search.frame.minX, app.buttons["bottom-tools"].frame.maxX)
        XCTAssertGreaterThanOrEqual(search.frame.width, 44)
        capture("47-bottom-right-search")
        search.tap()
        let field = app.textFields["globalSearchField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("卷积")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        capture("48-bottom-search-keyboard")
        app.buttons["返回导航"].tap()
        let publish = app.buttons["bottom-publish"]
        XCTAssertTrue(publish.waitForExistence(timeout: 5))
        publish.tap()
        XCTAssertTrue(app.buttons["menu-/publish"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["menu-/aichat"].exists)
        XCTAssertFalse(app.navigationBars["发布"].exists)
        capture("49-native-publish-popup")
        app.buttons["menu-/publish"].tap()
        XCTAssertTrue(app.navigationBars["发表讨论"].waitForExistence(timeout: 5))
    }
    func testNativeWorkbenchCalendarAndRanchStudy() {
        launchPreview()
        app.buttons["openWorkbench"].tap()
        let week = app.switches["七天视图"]
        XCTAssertTrue(week.waitForExistence(timeout: 5))
        week.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertTrue(app.scrollViews["nativeWeekCalendar"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.webViews.firstMatch.exists)
        capture("50-native-week-calendar")
        let add = app.buttons["addSchedule"]
        XCTAssertTrue(add.isHittable)
        add.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        capture("50a-native-schedule-sheet-open")
        XCTAssertTrue(app.textFields["workbenchTitle"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["类型"].exists)
        XCTAssertTrue(app.staticTexts["重复"].exists)
        capture("51-native-schedule-editor")
        app.buttons["取消"].tap()
        app.buttons["bottom-home"].tap()
        app.buttons["allFeatures"].tap()
        let search = app.searchFields.firstMatch
        search.tap(); search.typeText("牧场\n")
        tapIdentifiedElement("feature-/ranch")
        let studyButton = app.buttons["牧场学习"]
        expectation(for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: studyButton)
        waitForExpectations(timeout: 20)
        studyButton.tap()
        XCTAssertTrue(app.navigationBars["牧场学习"].waitForExistence(timeout: 5))
        let focus = app.buttons["ranch-focus"]
        XCTAssertTrue(focus.waitForExistence(timeout: 10))
        capture("52a-ranch-study-controls")
        XCTAssertTrue(focus.isHittable)
        let start = app.buttons["ranch-start"]
        if !start.exists { focus.tap() }
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.firstMatch.exists)
        XCTAssertTrue(app.webViews.staticTexts["25:00"].firstMatch.waitForExistence(timeout: 10))
        start.tap()
        let running = NSPredicate(format: "label CONTAINS %@", "暂停")
        expectation(for: running, evaluatedWith: app.buttons["ranch-start"])
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "24:[0-5][0-9]")).firstMatch.waitForExistence(timeout: 10))
        app.buttons["完成"].tap()
        XCTAssertTrue(app.navigationBars["电子牧场"].waitForExistence(timeout: 10))
        app.buttons["牧场学习"].tap()
        XCTAssertTrue(app.navigationBars["牧场学习"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["ranch-start"].label.contains("暂停"))
        app.buttons["ranch-start"].tap()
        let paused = NSPredicate(format: "label CONTAINS %@", "开始")
        expectation(for: paused, evaluatedWith: app.buttons["ranch-start"])
        waitForExpectations(timeout: 10)
        capture("52-native-ranch-study")
        XCUIDevice.shared.orientation = .landscapeLeft
        let reset = app.buttons["ranch-reset"]
        XCTAssertTrue(reset.waitForExistence(timeout: 10))
        XCTAssertTrue(reset.isHittable)
        XCTAssertTrue(app.buttons["ranch-focus"].isHittable)
        capture("53-ranch-study-landscape")
    }
    func testNativeCheckInCalendarAndContributionHeatmap() {
        launchPreview()
        XCTAssertTrue(app.scrollViews["contributionHeatmap"].waitForExistence(timeout: 10))
        capture("56-home-contribution-heatmap")
        app.buttons["openCheckIn"].tap()
        XCTAssertTrue(app.navigationBars["签到"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["签到日历"].exists)
        XCTAssertTrue(app.buttons["submitCheckIn"].exists)
        XCTAssertFalse(app.buttons["submitCheckIn"].isEnabled)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "已领取 4 磁元")).firstMatch.exists)
        let calendar = app.descendants(matching: .any).matching(identifier: "checkInCalendar").firstMatch
        XCTAssertTrue(calendar.exists)
        XCTAssertTrue(app.staticTexts["本月已签到 1 天 · 灰色为未签到"].exists)
        app.buttons["上个月"].tap()
        XCTAssertTrue(app.buttons["下个月"].isEnabled)
        app.buttons["下个月"].tap()
        XCTAssertFalse(app.buttons["下个月"].isEnabled)
        capture("54-native-checkin-calendar")
        app.buttons["完成"].tap()
        tapIdentifiedElement("ownPublicProfile")
        XCTAssertTrue(app.navigationBars["个人主页"].waitForExistence(timeout: 10))
        let heatmap = app.scrollViews["contributionHeatmap"]
        XCTAssertTrue(heatmap.waitForExistence(timeout: 10))
        XCTAssertTrue(app.datePickers["contributionDatePicker"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
        capture("55-native-contribution-heatmap")
    }
    func testNativeDecorationsAndGoldenNamePreview() {
        launchPreview()
        XCTAssertEqual(app.staticTexts["freebbs_preview"].value as? String, "金色名字")
        XCTAssertTrue(app.staticTexts["BBS见习观察员"].exists)
        app.buttons["个人设置"].tap()
        tapIdentifiedElement("ownDecorations")
        XCTAssertTrue(app.navigationBars["个人装扮"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["cosmetic-frame"].exists)
        XCTAssertTrue(app.buttons["cosmetic-nameplate"].exists)
        XCTAssertTrue(app.buttons["cosmetic-card"].exists)
        XCTAssertFalse(app.buttons["cosmetic-frame"].isEnabled)
        XCTAssertTrue(app.staticTexts["环流轨道"].exists || app.staticTexts["极光回路"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
        capture("57-native-decoration-wardrobe")
        app.swipeUp(velocity: .slow)
        XCTAssertTrue(app.staticTexts["黄金名片生效中"].exists)
        capture("58-native-golden-name-and-collection")
    }
    private func tapIdentifiedElement(_ id: String) {
        let deadline = Date().addingTimeInterval(60)
        var previousFrame: CGRect?
        var stationarySince: Date?
        var scrolls = 0
        while Date() < deadline {
            // Re-query after each snapshot. A resolved firstMatch can retain a
            // recycled SwiftUI List accessibility ID while its row is rebuilt.
            let item = app.buttons[id]
            if item.exists {
                let frame = item.frame
                let top = app.navigationBars.firstMatch.frame.maxY
                let bottom = app.buttons["bottom-home"].frame.minY
                if frame.width > 0 && frame.height > 0 && frame.minY >= top && frame.maxY <= bottom {
                    if app.buttons[id].isHittable {
                        let unchanged = previousFrame.map {
                            abs($0.minY - frame.minY) <= 0.5 && abs($0.maxY - frame.maxY) <= 0.5
                        } ?? false
                        if unchanged {
                            if let stationarySince, Date().timeIntervalSince(stationarySince) >= 0.3 {
                                app.coordinate(withNormalizedOffset: .zero)
                                    .withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
                                return
                            }
                        } else {
                            previousFrame = frame; stationarySince = Date()
                        }
                    } else { previousFrame = nil; stationarySince = nil }
                    RunLoop.current.run(until: Date().addingTimeInterval(0.35))
                    continue
                }
                guard scrolls < 8 else { break }
                if frame.minY < top { app.swipeDown(velocity: .slow) }
                else { app.swipeUp(velocity: .slow) }
            } else {
                guard scrolls < 8 else { break }
                app.swipeUp(velocity: .slow)
            }
            scrolls += 1; previousFrame = nil; stationarySince = nil
        }
        XCTFail("Identified button must settle inside the visible content: " + id)
    }
    private func back() {
        let navigation = app.navigationBars.firstMatch
        let previousTitle = navigation.identifier
        // Returning to a searchable list can restore search mode. Its first
        // navigation button closes search instead of popping the page.
        if !navigation.buttons["BackButton"].exists {
            let closeSearch = navigation.buttons.matching(
                NSPredicate(format: "label IN %@", ["关闭", "取消", "Close", "Cancel"])).firstMatch
            if closeSearch.exists {
                closeSearch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
        }
        let button = navigation.buttons["BackButton"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        XCTAssertTrue(button.isHittable)
        // The synthesized AX activation point can lag a navigation transition
        // on iOS 26. Tap the visible button and verify that navigation occurred.
        button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        // A predicate bound to the old navigation bar can keep reporting its
        // cached existence after UIKit has removed it. CI screen recordings
        // confirm the parent page is already visible in that case. Re-query
        // the currently displayed bar instead of waiting on the old object.
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            let current = app.navigationBars.firstMatch
            if current.exists && current.identifier != previousTitle {
                let frame = current.frame
                if frame.width > 0 && frame.height > 0 && app.frame.intersects(frame) { return }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        }
        capture("back-did-not-leave-" + previousTitle)
        XCTFail("Back must leave " + previousTitle)
    }
    private func revealProfileLogin() -> XCUIElement {
        revealVisibleListControl(app.buttons["profileLogin"])
    }
    private func revealVisibleListControl(_ item: XCUIElement) -> XCUIElement {
        var previousFrame: CGRect?
        var stationarySince: Date?
        var withinContent = false
        for _ in 0..<8 {
            let visible = NSPredicate { _, _ in
                withinContent = false
                guard item.exists, item.isHittable else {
                    previousFrame = nil; stationarySince = nil
                    return false
                }
                let frame = item.frame
                // iOS 27 can report a scrolling List row as hittable while its
                // synthesized tap falls under the navigation/status bars.
                guard frame.width > 0, frame.height > 0,
                      frame.minY >= self.app.navigationBars.firstMatch.frame.maxY,
                      frame.maxY <= self.app.buttons["bottom-home"].frame.minY else {
                    previousFrame = nil; stationarySince = nil
                    return false
                }
                withinContent = true
                if previousFrame.map({ abs($0.minY - frame.minY) > 0.5 ||
                    abs($0.maxY - frame.maxY) > 0.5 }) ?? true {
                    previousFrame = frame; stationarySince = Date()
                    return false
                }
                return stationarySince.map { Date().timeIntervalSince($0) >= 0.3 } ?? false
            }
            let ready = XCTNSPredicateExpectation(predicate: visible, object: nil)
            if XCTWaiter.wait(for: [ready], timeout: 6) == .completed { return item }
            // Remote AX snapshots can exceed one polling window. Preserve the
            // stability sample, and do not scroll an already visible row away.
            if withinContent { continue }
            previousFrame = nil; stationarySince = nil
            if item.exists && item.frame.minY < app.navigationBars.firstMatch.frame.maxY { app.swipeDown(velocity: .slow) }
            else { app.swipeUp(velocity: .slow) }
        }
        XCTFail("List control must settle inside the visible content\n" + item.debugDescription)
        return item
    }
    private func tapListText(_ text: String) {
        let item = app.staticTexts[text]
        // A List can discard rows above its restored scroll position. Begin
        // searching from the top when the requested row is not in the AX tree.
        if !item.exists {
            for _ in 0..<3 { app.swipeDown(velocity: .fast) }
        }
        let visible = revealVisibleListControl(item)
        visible.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars[text].waitForExistence(timeout: 10),
                      "List link must open " + text)
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
