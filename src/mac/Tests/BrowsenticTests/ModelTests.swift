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
