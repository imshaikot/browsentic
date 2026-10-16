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

    @Test func agentsSkillsActivityAndLogsLiveInSettings() {
        #expect(Tab.allCases.map(\.rawValue) == ["overview", "browsers", "android", "settings", "about"])
        #expect(SettingsSection.allCases.map(\.label) == ["General", "Agents", "Skills", "Activity", "Logs"])
        #expect(Tab.allCases.compactMap(\.badge) == ["Experimental"])
    }
}

@Suite struct PairingDecodingTests {
    private func decode<Value: Decodable>(_ type: Value.Type, _ json: String) throws -> Value {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    @Test func statusFromABridgeBeforeAutomaticPairingHasNoMode() throws {
        let status = try decode(BridgeStatus.self, #"{"connected":true,"daemonVersion":"0.8.9","protocolVersion":22,"port":8765,"manifestInSync":true,"pairedBrowsers":1,"pairingPending":false}"#)
        #expect(status.pairing == nil)
    }

    @Test func statusSaysHowBrowsersPairAndWhoAllowsThem() throws {
        let status = try decode(BridgeStatus.self, #"{"connected":true,"daemonVersion":"0.9.0","protocolVersion":23,"port":8765,"manifestInSync":true,"connectedBrowsers":1,"pairedBrowsers":1,"pairingPending":false,"pairing":{"mode":"ask","approver":"app"}}"#)
        #expect(status.pairing?.kind == .ask)
        #expect(status.pairing?.approver == "app")
    }

    @Test func aModeThisAppDoesNotKnowYetStillDecodes() throws {
        let setting = try decode(PairingSetting.self, #"{"id":"1","op":"pairing","mode":"later","approver":"terminal"}"#)
        #expect(setting.kind == nil)
        #expect(setting.error == nil)
    }

    @Test func aRefusedModeChangeCarriesTheBridgesReason() throws {
        let setting = try decode(PairingSetting.self, #"{"id":"1","op":"pairing","mode":"auto","approver":"app","error":"An agent run cannot change how browsers pair."}"#)
        #expect(setting.kind == .auto)
        #expect(setting.error == "An agent run cannot change how browsers pair.")
    }

    @Test func sessionsFromABridgeBeforeAutomaticPairingReadAsPairedWithACode() throws {
        let session = try decode(BrowserSession.self, #"{"id":"i1","browser":"Chrome","origin":"chrome-extension://abc","source":"chrome-web-store","extensionVersion":"0.8.9","pairedAt":"2026-10-01T10:00:00.000Z","lastSeenAt":"2026-10-01T10:00:00.000Z","connected":true}"#)
        #expect(session.label == nil)
        #expect(session.paired == .code)
        #expect(session.paired.label == "Paired with a code")
        #expect(session.displayName == "Chrome")
    }

    @Test func aNamedSessionGoesByItsName() throws {
        let session = try decode(BrowserSession.self, #"{"id":"i1","browser":"Chrome","origin":"chrome-extension://abc","extensionVersion":"0.9.0","pairedAt":"2026-10-01T10:00:00.000Z","lastSeenAt":"2026-10-01T10:00:00.000Z","connected":false,"label":"Work Chrome","pairedBy":"auto"}"#)
        #expect(session.name == "Work Chrome")
        #expect(session.paired.label == "Paired by itself")
        #expect(session.pairing == "i1@2026-10-01T10:00:00.000Z")
    }

    @Test func aSessionWithNoBrowserOrNameStillHasSomethingToCallIt() throws {
        let session = try decode(BrowserSession.self, #"{"origin":"chrome-extension://abc","extensionVersion":"0.5.0","pairedAt":"2026-09-01T10:00:00.000Z","lastSeenAt":"2026-09-01T10:00:00.000Z","connected":true,"pairedBy":"approved"}"#)
        #expect(session.name == nil)
        #expect(session.displayName == "This browser")
        #expect(session.paired.label == "Allowed")
    }

    @Test func pairRequestsSayWhoIsAskingAndWhen() throws {
        let requests = try decode([PairRequest].self, #"""
        [{"id":"r1","installId":"0123456789abcdef","browser":"Brave","source":"chrome-web-store","extensionVersion":"0.9.0","firstAt":1790000000000,"lastAskAt":1790000005000,"nonce":"n1"},
         {"id":"r2","installId":"fedcba9876543210","source":"unpacked","extensionVersion":"0.9.0","firstAt":1790000001000,"lastAskAt":1790000001000,"nonce":"n2"}]
        """#)
        #expect(requests[0].name == "Brave")
        #expect(requests[0].shortId == "01234567")
        #expect(requests[0].askedAt == Date(timeIntervalSince1970: 1_790_000_000))
        #expect(requests[1].name == "A browser")
        #expect(SourceLabel.of(requests[1].source).capitalizedFirst == "Unpacked")
    }

    @Test func keptOutBrowsersSayWhy() throws {
        let blocked = try decode([BlockedBrowser].self, #"""
        [{"installId":"0123456789abcdef","browser":"Edge","origin":"chrome-extension://x","at":"2026-10-16T09:00:00.000Z","reason":"revoked"},
         {"installId":"fedcba9876543210","origin":"moz-extension://","at":"2026-10-16T09:00:00.000Z","reason":"denied"}]
        """#)
        #expect(blocked.map(\.why) == ["Unpaired", "Denied"])
        #expect(blocked.map(\.name) == ["Edge", "A browser"])
        #expect(blocked[1].id == "fedcba9876543210")
        #expect(Timestamp.date(blocked[0].at) != nil)
    }

    @Test func anOpThatOnlySucceedsOrFailsCarriesItsError() throws {
        #expect(try decode(Acknowledgement.self, #"{"id":"1","op":"decide","ok":true}"#).ok)
        let refused = try decode(Acknowledgement.self, #"{"id":"1","op":"decide","ok":false,"error":"No request or blocked browser has that id."}"#)
        #expect(!refused.ok)
        #expect(BridgeRefusal(message: refused.error ?? "").localizedDescription == "No request or blocked browser has that id.")
    }

    @Test func everyModeIsOneTheBridgeKnowsWithItsOwnLine() {
        #expect(PairingMode.allCases.map(\.rawValue) == ["auto", "ask", "code"])
        #expect(PairingMode.allCases.map(\.label) == ["Automatic", "Ask me", "Code only"])
        #expect(PairingMode.allCases.map(\.detail) == [
            "A browser with Browsentic connects by itself.",
            "You allow each new browser here first.",
            "A browser connects only with a code you type into it.",
        ])
        #expect(PairingMode.allCases.filter(\.pairsByItself) == [.auto, .ask])
    }
}

@Suite struct PairingWatchTests {
    private func request(_ id: String, at firstAt: Double, nonce: String = "nonce") -> PairRequest {
        PairRequest(id: id, installId: "install-\(id)", browser: "Chrome", source: "chrome-web-store", extensionVersion: "0.9.0", firstAt: firstAt, lastAskAt: firstAt, nonce: nonce)
    }

    private func session(_ id: String, pairedBy: String?, at pairedAt: String = "2026-10-16T09:00:00.000Z") -> BrowserSession {
        BrowserSession(sessionId: id, browser: "Chrome", origin: "chrome-extension://\(id)", source: "chrome-web-store", extensionVersion: "0.9.0", pairedAt: pairedAt, lastSeenAt: pairedAt, connected: true, label: nil, pairedBy: pairedBy)
    }

    @Test func theQueueShowsTheOldestRequestFirst() {
        let queue = PairingWatch.queue([request("b", at: 2), request("c", at: 3), request("a", at: 1)])
        #expect(queue.map(\.id) == ["a", "b", "c"])
    }

    @Test func eachRequestIsAnnouncedOnce() {
        let requests = [request("a", at: 1), request("b", at: 2)]
        #expect(PairingWatch.arrived(requests, announced: []).map(\.id) == ["a", "b"])
        #expect(PairingWatch.arrived(requests, announced: ["a"]).map(\.id) == ["b"])
        #expect(PairingWatch.arrived(requests, announced: ["a", "b"]).isEmpty)
    }

    @Test func aDecidedOrExpiredRequestIsGone() {
        let before = [request("a", at: 1), request("b", at: 2)]
        #expect(PairingWatch.gone([request("b", at: 2)], previous: before) == ["a"])
        #expect(PairingWatch.gone(before, previous: before).isEmpty)
        #expect(PairingWatch.gone([], previous: before) == ["a", "b"])
    }

    @Test func browsersAlreadyThereOnTheFirstLookAreNotNews() {
        let sessions = [session("one", pairedBy: "auto")]
        #expect(PairingWatch.pairedByThemselves(sessions, seen: nil).isEmpty)
    }

    @Test func onlyABrowserThatPairedByItselfIsAnnounced() {
        let sessions = [session("auto", pairedBy: "auto"), session("allowed", pairedBy: "approved"), session("code", pairedBy: "code"), session("old", pairedBy: nil)]
        #expect(PairingWatch.pairedByThemselves(sessions, seen: []).map(\.id) == ["auto"])
        #expect(PairingWatch.pairedByThemselves(sessions, seen: Set(sessions.map(\.pairing))).isEmpty)
    }

    @Test func theSameBrowserPairingAgainIsAnnouncedAgain() {
        let first = session("one", pairedBy: "auto", at: "2026-10-16T09:00:00.000Z")
        let again = session("one", pairedBy: "auto", at: "2026-10-16T10:00:00.000Z")
        #expect(PairingWatch.pairedByThemselves([again], seen: [first.pairing]).map(\.id) == ["one"])
    }

    @Test func aNotificationAnswerCountsOnlyWithTheRequestsOwnNonce() {
        let waiting = [request("a", at: 1, nonce: "secret")]
        #expect(PairingWatch.answerable("a", nonce: "secret", in: waiting)?.id == "a")
        #expect(PairingWatch.answerable("a", nonce: "guess", in: waiting) == nil)
        #expect(PairingWatch.answerable("b", nonce: "secret", in: waiting) == nil)
        #expect(PairingWatch.answerable("a", nonce: "secret", in: []) == nil)
        #expect(PairingWatch.answerable("a", nonce: "", in: [request("a", at: 1, nonce: "")]) == nil)
    }
}

@Suite struct NoticeTests {
    private func decode<Value: Decodable>(_ type: Value.Type, _ json: String) throws -> Value {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    private func status(protocolVersion: Int) throws -> BridgeStatus {
        try decode(BridgeStatus.self, #"{"connected":true,"daemonVersion":"0.9.0","protocolVersion":\#(protocolVersion),"port":8765,"manifestInSync":true,"pairedBrowsers":1,"pairingPending":false}"#)
    }

    @Test func aNoticeCarriesWhatTheNotificationShows() throws {
        let notice = try decode(QueuedNotice.self, #"{"id":"monitor:42:3","kind":"monitor","title":"Price dropped","body":"The jacket is now $80.","tone":"live","browser":"Work Chrome","at":1790000000000}"#)
        #expect(notice.title == "Price dropped")
        #expect(notice.body == "The jacket is now $80.")
        #expect(notice.browser == "Work Chrome")
        #expect(notice.kind == "monitor" && notice.tone == "live")
    }

    @Test func aKindOrToneThisAppDoesNotKnowKeepsTheNotice() throws {
        let notice = try decode(QueuedNotice.self, #"{"id":"n1","kind":"reminder","title":"T","body":"B","tone":"loud","at":1}"#)
        #expect(notice.kind == "reminder" && notice.tone == "loud")
        let bare = try decode(QueuedNotice.self, #"{"id":"n2","title":"T","body":"B"}"#)
        #expect(bare.kind == nil && bare.tone == nil && bare.browser == nil)
    }

    @Test func oneMalformedNoticeNeverCostsTheOthers() throws {
        let list = try decode(LossyList<QueuedNotice>.self, #"""
        [{"id":"a","kind":"task","title":"Done","body":"x","tone":"warn","at":1},
         {"kind":"timer","body":"no id or title"},
         "not even an object",
         {"id":"b","kind":"timer","title":"Time's up","body":"y","tone":"live","at":2}]
        """#)
        #expect(list.items.map(\.id) == ["a", "b"])
        #expect(try decode(LossyList<QueuedNotice>.self, "[]").items.isEmpty)
    }

    @Test func onlyABridgeThatKnowsNoticesIsAskedAboutThem() throws {
        #expect(!NoticeWatch.supported(by: nil))
        #expect(!NoticeWatch.supported(by: try status(protocolVersion: 23)))
        #expect(NoticeWatch.supported(by: try status(protocolVersion: 24)))
        #expect(NoticeWatch.supported(by: try status(protocolVersion: 25)))
    }

    @Test func theBridgeHearsAboutPermissionOnANewSocketAndWhenItChanges() {
        #expect(NoticeWatch.needsReport(allowed: false, reported: nil))
        #expect(NoticeWatch.needsReport(allowed: true, reported: nil))
        #expect(!NoticeWatch.needsReport(allowed: true, reported: true))
        #expect(!NoticeWatch.needsReport(allowed: false, reported: false))
        #expect(NoticeWatch.needsReport(allowed: true, reported: false))
        #expect(NoticeWatch.needsReport(allowed: false, reported: true))
    }

    @Test func onlyAGrantedPermissionLetsTheAppShowNotices() {
        #expect(NoticeWatch.allows(.authorized))
        #expect(NoticeWatch.allows(.provisional))
        #expect(!NoticeWatch.allows(.denied))
        #expect(!NoticeWatch.allows(.notDetermined))
    }

    @Test func aRepeatOfTheSameEventReplacesItsNotification() {
        #expect(NoticeWatch.identifier(for: "monitor:42:3") == "notice:monitor:42:3")
        #expect(NoticeWatch.identifier(for: "monitor:42:3") == NoticeWatch.identifier(for: "monitor:42:3"))
        #expect(NoticeWatch.identifier(for: "a") != "a")
    }
}

@Suite struct BrowserAppsTests {
    @Test func everyBrandTheExtensionReportsNamesItsApps() {
        let brands = ["Google Chrome", "Chromium", "Microsoft Edge", "Brave", "Opera", "Vivaldi", "Arc", "Firefox"]
        #expect(brands.allSatisfy { !BrowserApps.candidates(for: $0).isEmpty })
        #expect(BrowserApps.candidates(for: "Google Chrome").first == "com.google.Chrome")
        #expect(BrowserApps.candidates(for: "Microsoft Edge").first == "com.microsoft.edgemac")
        #expect(BrowserApps.candidates(for: "Arc") == ["company.thebrowser.Browser"])
        #expect(BrowserApps.candidates(for: "Firefox").first == "org.mozilla.firefox")
    }

    @Test func noBundleIdBelongsToTwoBrands() {
        let ids = BrowserApps.bundleIds.values.flatMap { $0 }
        #expect(Set(ids).count == ids.count)
    }

    @Test func theRunningChannelIsTheOneThatComesForward() {
        #expect(BrowserApps.running(for: "Google Chrome", among: ["com.google.Chrome.canary", "com.apple.Safari"]) == "com.google.Chrome.canary")
        #expect(BrowserApps.running(for: "Google Chrome", among: ["com.google.Chrome", "com.google.Chrome.beta"]) == "com.google.Chrome")
        #expect(BrowserApps.running(for: "microsoft edge", among: ["com.microsoft.edgemac.Dev"]) == "com.microsoft.edgemac.Dev")
    }

    @Test func anUnknownBrandOrABrowserNotRunningYieldsToNothing() {
        #expect(BrowserApps.running(for: "Netscape", among: ["com.google.Chrome"]) == nil)
        #expect(BrowserApps.running(for: nil, among: ["com.google.Chrome"]) == nil)
        #expect(BrowserApps.running(for: "chrome-extension://abc", among: ["com.google.Chrome"]) == nil)
        #expect(BrowserApps.running(for: "Brave", among: ["com.google.Chrome"]) == nil)
    }
}
