import XCTest
final class StandaloneTests: XCTestCase {
    var out = "/tmp/standalone"
    func dump(_ app: XCUIApplication, _ name: String) {
        try? app.debugDescription.write(toFile: "\(out)/\(name).txt", atomically: true, encoding: .utf8)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
    }
    func tapFirst(_ app: XCUIApplication, _ labels: [String], _ step: String) -> Bool {
        for l in labels {
            for q in [app.buttons[l], app.cells[l], app.staticTexts[l], app.otherElements[l]] where q.firstMatch.waitForExistence(timeout: 2) {
                q.firstMatch.tap(); return true
            }
        }
        dump(app, "missing-\(step)"); return false
    }
    func testAddToHomeScreenAndOpen() throws {
        out = ProcessInfo.processInfo.environment["CHECK_OUT"] ?? out
        try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let sb0 = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCUIDevice.shared.press(.home); sleep(2)
        if sb0.icons["composer device check"].waitForExistence(timeout: 3) {
            return openClip(sb0)
        }
        safari.activate(); sleep(2)
        if safari.keyboards.firstMatch.exists { safari.buttons["Done"].firstMatch.tap(); sleep(1) }
        guard tapFirst(safari, ["MoreMenuButton", "More"], "more") else { return XCTFail("more") }
        sleep(1); dump(safari, "a-more")
        guard tapFirst(safari, ["Share"], "share") else { return XCTFail("share") }
        sleep(2); dump(safari, "b-share")
        if !tapFirst(safari, ["Add to Home Screen"], "add") {
            safari.swipeUp(); sleep(1)
            guard tapFirst(safari, ["Add to Home Screen"], "add2") else { return XCTFail("add to home") }
        }
        sleep(2); dump(safari, "c-addsheet")
        let add = safari.buttons["Add"].firstMatch
        let enabled = NSPredicate(format: "isEnabled == true")
        expectation(for: enabled, evaluatedWith: add); waitForExpectations(timeout: 15)
        add.tap(); sleep(4)
        XCUIDevice.shared.press(.home); sleep(2)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        dump(springboard, "d-springboard")
        openClip(springboard)
    }

    func openClip(_ springboard: XCUIApplication) {
        let icon = springboard.icons.matching(NSPredicate(format: "label CONTAINS[c] 'composer' OR label CONTAINS[c] 'localhost'")).firstMatch
        guard icon.waitForExistence(timeout: 10) else { return XCTFail("no web clip icon") }
        var swipes = 0
        while !icon.isHittable && swipes < 4 { springboard.swipeLeft(); sleep(1); swipes += 1 }
        icon.tap(); sleep(5)
        for bid in ["com.apple.webapp", "com.apple.WebSheet", "com.apple.mobilesafari.webapp"] {
            let app = XCUIApplication(bundleIdentifier: bid)
            if app.state == .runningForeground { runComposer(app, bid); return }
        }
        dump(springboard, "e-after-icon")
        runComposer(springboard, "springboard")
    }

    func runComposer(_ app: XCUIApplication, _ bid: String) {
        try? bid.write(toFile: "\(out)/bundle.txt", atomically: true, encoding: .utf8)
        dump(app, "f-webapp-loaded")
        let field = app.textViews["Say more"].firstMatch
        guard field.waitForExistence(timeout: 45) else { return XCTFail("composer not found in \(bid)") }
        field.tap(); sleep(2)
        field.typeText("Write the full text of chapter 1, but get your numbering right this time please")
        sleep(2)
        dump(app, "g-webapp-typed")
    }
}
