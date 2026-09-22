# Device checks (not CI)

jsdom has no keyboard, no `visualViewport` and no `dvh`, so the composer-with-keyboard
behaviour can only be checked on iOS. This drives it in the iOS Simulator.

1. Build and serve the harness (`vite build` — a home-screen web app left the dev server's unbundled modules blank):
   `npx vite build --config tests/device/vite.device.config.js && cp tests/device/.dist/composer.html tests/device/.dist/index.html && (cd tests/device/.dist && python3 -m http.server 5174)`
2. Disconnect the Simulator's hardware keyboard for the device (per-device pref `ConnectHardwareKeyboard=false`), boot it.
3. `cd tests/device/xcui && xcodegen generate` then
   `TEST_RUNNER_CHECK_OUT=/tmp/out xcodebuild test -project ComposerDeviceCheck.xcodeproj -scheme UITests -destination id=<udid> CODE_SIGNING_ALLOWED=NO`
   - `ComposerKeyboardTests` — Safari tab: types into "Say more" with the software keyboard, writes screenshots + the accessibility tree.
   - `StandaloneTests` — adds the page to the Home Screen, opens it as a web app (`com.apple.webapp`), same check.

The page's overlay prints `visualViewport` metrics live. Use the XCUI frames in the tree (screen points), not the overlay's `getBoundingClientRect`, to judge overlap: on iOS those are layout-viewport coordinates.
