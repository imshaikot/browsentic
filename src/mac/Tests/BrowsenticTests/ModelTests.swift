import Foundation
import Testing
@testable import Browsentic

@Suite struct VersionTests {
    @Test func comparesReleases() {
        #expect(Version.isNewer("0.5.1", than: "0.5.0"))
        #expect(Version.isNewer("0.10.0", than: "0.9.9"))
        #expect(!Version.isNewer("0.5.0", than: "0.5.0"))
        #expect(!Version.isNewer("0.4.15", than: "0.5.0"))
    }

    @Test func readsNodeMajor() {
        #expect(Version.major("v22.11.0\n") == 22)
        #expect(Version.major("18.2.0") == 18)
        #expect(Version.major("") == 0)
    }
}

@Suite struct PairingCodeTests {
    @Test func groupsForReadingAloud() {
        let pairing = PairingCode(code: "ABCD2345", expiresAt: 1_790_000_000_000)
        #expect(pairing.grouped == "ABCD-2345")
        #expect(pairing.expiry == Date(timeIntervalSince1970: 1_790_000_000))
    }
}

@Suite struct DecodingTests {
    @Test func statusFrameWithoutAnExtension() throws {
        let frame = #"{"connected":false,"daemonVersion":"0.5.0","protocolVersion":16,"port":8765,"manifestInSync":true,"pairedBrowsers":0,"pairingPending":false}"#
        let status = try JSONDecoder().decode(BridgeStatus.self, from: Data(frame.utf8))
        #expect(status.extensionVersion == nil)
        #expect(status.port == 8765)
    }

    @Test func agentListingCarriesTheCatalog() throws {
        let listing = """
        {"active":"claude","runners":[{"kind":"codex","bin":"codex","ready":false,
        "problem":{"code":"AGENT_MISSING","message":"Codex is not installed","fix":"npm i -g @openai/codex"}}],
        "catalog":[{"kind":"codex","label":"Codex","vendor":"OpenAI","bin":"codex","install":"npm i -g @openai/codex","docs":"https://x","models":["a"]},
        {"kind":"antigravity","label":"Antigravity","vendor":"Google","bin":"agy","install":"https://antigravity.google/docs/cli/install","docs":"https://y","models":[]}]}
        """
        let state = try JSONDecoder().decode(AgentState.self, from: Data(listing.utf8))
        #expect(state.runners[0].problem?.grantable == nil)
        #expect(state.catalog?[0].installsWithNpm == true)
        #expect(state.catalog?[1].installsWithNpm == false)
    }

    @Test func browserRowsSayWhereEachBrowserGetsTheExtensionAndWhichCopyItRuns() throws {
        let listing = #"""
        {"running":true,"browsers":[
        {"id":"chrome","label":"Chrome","installed":true,"source":"chrome-web-store","store":"Chrome Web Store","storeUrl":"https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp","steps":["Press “Add to Chrome”."],"extensionsPage":"chrome://extensions","connected":true,
         "sessions":[{"id":"s1","source":"chrome-web-store","extensionVersion":"0.8.0","connected":true}]},
        {"id":"firefox","label":"Firefox","installed":true,"source":"firefox","store":"Firefox add-on","storeUrl":"https://x/browsentic-0.8.0-firefox.xpi","steps":["Say yes to both."],"extensionsPage":"about:addons","connected":false,"sessions":[]}],
        "unpacked":{"dir":"/Users/me/browsentic/extension/chrome-mv3","version":null}}
        """#
        let rows = try JSONDecoder().decode(BrowserListing.self, from: Data(listing.utf8)).browsers
        #expect(rows.map { "\($0.label): \($0.copy.map { SourceLabel.of($0.source) } ?? $0.addTitle)" } == ["Chrome: Chrome Web Store", "Firefox: Get the Firefox add-on"])
    }

    @Test func setupWithNoUnpackedFolderStillDecodes() throws {
        let result = #"{"version":"0.8.0","daemon":{"port":8765,"pid":1},"extensionDir":null,"alreadyPaired":false,"chosen":{"id":"edge","unpacked":false,"opened":true,"connected":false},"pairingCode":"K7QM3XPT","expiresAt":1790000000000}"#
        let setup = try JSONDecoder().decode(SetupResult.self, from: Data(result.utf8))
        #expect(setup.extensionDir == nil)
        #expect(setup.chosen?.opened == true)
        #expect(setup.pairingCode == "K7QM3XPT")
    }

    @Test func sessionShowsTheExtensionIdAlone() throws {
        let row = #"{"origin":"chrome-extension://abcdef","extensionVersion":"0.5.0","pairedAt":"2026-09-01T10:00:00.000Z","lastSeenAt":"2026-09-01T10:00:00.000Z","connected":true}"#
        let session = try JSONDecoder().decode(BrowserSession.self, from: Data(row.utf8))
        #expect(session.extensionId == "abcdef")
    }

    @Test func preferencesCarryALockedRuleAndOneLeftOnItsDefault() throws {
        let result = #"""
        {"ok":true,"data":{"theme":null,"guardrails":{"rules":[
        {"id":"secret-in-url","title":"Secret in a URL","reason":"A credential never travels in a query string.","fallback":"deny","locked":true},
        {"id":"form-submission","title":"Submits a form","reason":"Submitting a form is a consequential action.","fallback":"confirm","override":"allow"},
        {"id":"file-upload","title":"Uploads one of the user's files","reason":"It hands the file to the site.","fallback":"confirm"}],
        "fence":{"enabled":true,"overridden":false},"unattended":{"effect":"deny","overridden":false},"hosts":[],"configPath":"/Users/x/.browsentic/config.json"}}}
        """#
        let preferences = try JSONDecoder().decode(Outcome<Preferences>.self, from: Data(result.utf8)).value()
        #expect(preferences.theme == nil)
        #expect(preferences.guardrails.rules.map(\.isLocked) == [true, false, false])
        #expect(preferences.guardrails.rules.map(\.choice) == [nil, "allow", nil])
        #expect(RuleEffect.label(preferences.guardrails.rules[1].fallback) == "Ask")
    }

    @Test func aRefusedChangeThrowsTheDaemonsOwnMessage() throws {
        let result = #"{"ok":false,"error":{"code":"BLOCKED","message":"An agent run cannot change the settings it runs under."}}"#
        let outcome = try JSONDecoder().decode(Outcome<Preferences>.self, from: Data(result.utf8))
        #expect(throws: Outcome<Preferences>.Failure.self) { try outcome.value() }
        #expect((try? outcome.value()) == nil)
        #expect(outcome.error?.localizedDescription == "An agent run cannot change the settings it runs under.")
    }

    @Test func everyBrowserThemeIsOneTheExtensionKnows() {
        #expect(BrowserTheme.allCases.map(\.rawValue) == ["ember", "midnight", "phosphor", "daylight"])
    }

    @Test func timestampsReadTheDaemonsIsoStrings() {
        #expect(Timestamp.date("2026-09-17T14:21:45.381Z") != nil)
        #expect(Timestamp.ago("not a date") == "not a date")
    }
}

@Suite struct UpdateTests {
    @Test func takesTheNewerOfGitHubAndNpm() {
        #expect(UpdateFeed.newest(of: ["0.6.3", "0.7.0"], after: "0.6.2") == "0.7.0")
        #expect(UpdateFeed.newest(of: ["0.7.0", "0.6.3"], after: "0.6.2") == "0.7.0")
        #expect(UpdateFeed.newest(of: [nil, "0.6.3"], after: "0.6.2") == "0.6.3")
    }

    @Test func offersNothingWhenCurrentOrAhead() {
        #expect(UpdateFeed.newest(of: ["0.6.2", "0.6.2"], after: "0.6.2") == nil)
        #expect(UpdateFeed.newest(of: ["0.6.1", nil], after: "0.6.2") == nil)
        #expect(UpdateFeed.newest(of: [nil, nil], after: "0.6.2") == nil)
    }

    @Test func releaseLinksFollowTheAssetNameTheInstallerUses() {
        let release = AppRelease(version: "0.7.0", hasMacBuild: true)
        #expect(release.dmg.absoluteString == "https://github.com/imshaikot/browsentic/releases/download/v0.7.0/Browsentic-0.7.0.dmg")
        #expect(release.notes.absoluteString == "https://github.com/imshaikot/browsentic/releases/tag/v0.7.0")
    }

    @Test func replacesTheRunningBundleOnlyWhereItCanBeReplaced() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("browsentic-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }

        let writable = folder.appendingPathComponent("Browsentic.app", isDirectory: true)
        #expect(try AppUpdater.destination(running: writable) == writable)

        let translocated = URL(fileURLWithPath: "/private/var/folders/xx/T/AppTranslocation/1234/d/Browsentic.app", isDirectory: true)
        #expect(try AppUpdater.destination(running: translocated).lastPathComponent == "Browsentic.app")
        #expect(try AppUpdater.destination(running: translocated) != translocated)

        #expect(throws: UpdateError.self) { try AppUpdater.destination(running: folder.appendingPathComponent("debug/Browsentic")) }
    }

    @Test func onlyTheInstallingPhasesBlockASecondPress() {
        #expect(UpdatePhase.downloading(0.4).isInstalling)
        #expect(UpdatePhase.verifying.isInstalling)
        #expect(UpdatePhase.relaunching.isInstalling)
        #expect(!UpdatePhase.failed("offline").isInstalling)
        #expect(!UpdatePhase.checking.isInstalling)
    }
}

@Suite struct AboutTests {
    @Test func opensTheBugFormWithTheVersionsFilledIn() {
        let url = About.bugReport(environment: "App 0.7.15+build · Daemon off & idle", agent: "Codex 0.42.0")
        let fields = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(url.absoluteString.hasPrefix("https://github.com/imshaikot/browsentic/issues/new?"))
        #expect(url.query?.contains("%2Bbuild") == true)
        #expect(fields.map(\.name) == ["template", "environment", "agent"])
        #expect(fields.first { $0.name == "template" }?.value == "bug_report.yml")
    }

    @Test func leavesTheAgentToTheReporterWhenNoneIsKnown() {
        let fields = URLComponents(url: About.bugReport(environment: "App 0.7.15", agent: nil), resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(!fields.contains { $0.name == "agent" })
    }

    @Test func namesTheActiveAgentWithTheReleaseItsCLIPrinted() throws {
        let json = #"{"active":"claude","runners":[{"kind":"claude","bin":"claude","ready":true,"version":"2.1.284 (Claude Code)"}],"catalog":[{"kind":"claude","label":"Claude Code","vendor":"Anthropic","bin":"claude","install":"npm i -g @anthropic-ai/claude-code","docs":"https://example.com","models":[]}]}"#
        let state = try JSONDecoder().decode(AgentState.self, from: Data(json.utf8))
        #expect(About.agent(state) == "Claude Code 2.1.284")
        #expect(About.agent(nil) == nil)
    }

    @Test func readsTheVersionsAsOneLine() {
        #expect(About.describe([About.Row(label: "App", value: "0.7.15"), About.Row(label: "Protocol", value: "22")]) == "App 0.7.15 · Protocol 22")
    }
}


/// The samples `browsentic android --json` writes in src/lib/phone/fixtures, kept current by the CLI's own tests.
@Suite struct AndroidDecodingTests {
    private func sample(_ name: String) throws -> AndroidState {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../..").standardized
        let data = try Data(contentsOf: repo.appendingPathComponent("src/lib/phone/fixtures/android-\(name).json"))
        return try JSONDecoder().decode(AndroidState.self, from: data)
    }

    @Test func ready() throws {
        let state = try sample("ready")
        #expect(state.isReady)
        #expect(state.devices?.first?.chrome?.debuggable == true)
        #expect(state.report?.sections.flatMap(\.checks).map(\.label) == ["adb", "Phone", "USB debugging", "Chrome", "Chrome open", "Screen"])
        #expect(state.report?.summary == "Ready. Switch on Android in the Browsentic side panel to drive it.")
        #expect(state.guide?.count == 6)
    }

    @Test func noAdb() throws {
        let state = try sample("adbMissing")
        #expect(state.adb?.found == false)
        let check = state.report?.sections.first?.checks.first
        #expect(check?.code == "ADB_MISSING" && check?.failed == true)
        #expect(check?.fix == "brew install --cask android-platform-tools")
        #expect(state.report?.guided == true)
    }

    @Test func noPhone() throws {
        let state = try sample("noDevice")
        #expect(state.devices?.isEmpty == true)
        #expect(state.problem?.code == "NO_DEVICE")
        #expect(state.report?.sections.last?.checks.last?.label == "Phone")
    }

    @Test func unauthorized() throws {
        let state = try sample("unauthorized")
        #expect(state.devices?.first?.state == "unauthorized")
        #expect(state.report?.sections.last?.checks.last?.code == "DEVICE_UNAUTHORIZED")
        #expect(state.guide?.contains { $0.platform == "android11+" } == true)
    }

    @Test func theControlSocketAnswerHasNoReport() throws {
        let answer = #"{"enabled":true,"ready":false,"adb":{"found":true,"path":"/x/adb"},"devices":[],"problem":{"code":"NO_DEVICE","message":"No Android phone is connected."}}"#
        let state = try JSONDecoder().decode(AndroidState.self, from: Data(answer.utf8))
        #expect(state.report == nil && state.guide == nil && state.isReady == false)
    }
}

@Suite struct TabTests {
    /// The View menu gives tab n the shortcut ⌘n, and `Character("10")` traps: nine tabs is the most there can be.
    @Test func everyTabHasADigitShortcut() {
        #expect(Tab.allCases.count <= 9)
        #expect(Tab.allCases.firstIndex(of: .android) == 2)
        #expect(Tab.allCases.last == .about)
    }
}
