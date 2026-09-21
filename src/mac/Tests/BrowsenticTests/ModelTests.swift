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

    @Test func sessionShowsTheExtensionIdAlone() throws {
        let row = #"{"origin":"chrome-extension://abcdef","extensionVersion":"0.5.0","pairedAt":"2026-09-01T10:00:00.000Z","lastSeenAt":"2026-09-01T10:00:00.000Z","connected":true}"#
        let session = try JSONDecoder().decode(BrowserSession.self, from: Data(row.utf8))
        #expect(session.extensionId == "abcdef")
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
