import XCTest

/// Drives Mobile Safari on the simulator: open the composer device page, tap
/// "Say more", type a long sentence with the SOFTWARE keyboard, then record a
/// screenshot and the page's own geometry overlay.
final class ComposerKeyboardTests: XCTestCase {
    func testComposerWithKeyboardRaised() throws {
        let env = ProcessInfo.processInfo.environment
        let url = env["CHECK_URL"] ?? "http://localhost:5174/composer.html"
        let out = env["CHECK_OUT"] ?? "/tmp/composer-check"
        try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()
        // Address bar: tap the URL field, type the URL, go.
        let address = safari.textFields.firstMatch
        if !address.waitForExistence(timeout: 10) {
            safari.buttons["TabBarItemTitle"].firstMatch.tap()
        }
        address.tap()
        safari.typeText(url + "\n")
        sleep(4)
        save(safari, out, "1-loaded")

        let field = safari.textViews["Say more"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), "composer not found")
        field.tap()
        sleep(2)
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 5), "software keyboard did not appear (hardware keyboard connected?)")
        save(safari, out, "2-focused")
        field.typeText("Write the full text of chapter 1, but get your numbering right this time please")
        sleep(2)
        save(safari, out, "3-typed-long")

        try? safari.debugDescription.write(toFile: out + "/tree.txt", atomically: true, encoding: .utf8)
        let kb = safari.keyboards.firstMatch.frame
        var lines = ["keyboard=\(kb)", "field=\(field.frame)", "window=\(safari.windows.firstMatch.frame)"]
        try? lines.joined(separator: "\n").write(toFile: out + "/xcui-frames.txt", atomically: true, encoding: .utf8)
        try? safari.debugDescription.write(toFile: out + "/tree.txt", atomically: true, encoding: .utf8)
    }

    private func save(_ app: XCUIApplication, _ dir: String, _ name: String) {
        let shot = XCUIScreen.main.screenshot()
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }
}
