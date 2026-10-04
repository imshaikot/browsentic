import Foundation

struct Lockfile: Decodable, Equatable {
    let pid: Int
    let port: Int
    let token: String
    let daemonVersion: String?
}

struct BridgeStatus: Decodable, Equatable {
    let connected: Bool
    let daemonVersion: String
    let protocolVersion: Int
    let port: Int
    let manifestInSync: Bool
    let extensionVersion: String?
    let pairedBrowsers: Int
    let pairingPending: Bool
}

struct BrowserSession: Decodable, Identifiable, Equatable {
    /// Absent from a daemon that still knows a browser by its origin alone.
    let sessionId: String?
    let browser: String?
    let origin: String
    /// Where its extension came from; absent from a daemon before 0.8, which knew only the unpacked copy.
    let source: String?
    let extensionVersion: String
    let pairedAt: String
    let lastSeenAt: String
    let connected: Bool

    enum CodingKeys: String, CodingKey {
        case sessionId = "id"
        case browser, origin, source, extensionVersion, pairedAt, lastSeenAt, connected
    }

    var id: String { sessionId ?? origin }
    var extensionId: String { origin.replacingOccurrences(of: #"^[a-z-]+-extension://"#, with: "", options: .regularExpression) }
}

struct PairingCode: Decodable, Equatable {
    let code: String
    let expiresAt: Double

    var expiry: Date { Date(timeIntervalSince1970: expiresAt / 1000) }
    var grouped: String { code.count > 4 ? "\(code.prefix(4))-\(code.dropFirst(4))" : code }
}

struct AgentProblem: Decodable, Equatable {
    let code: String
    let message: String
    let fix: String?
    let grantable: Bool?
}

struct RunnerStatus: Decodable, Identifiable, Equatable {
    let kind: String
    let bin: String
    let ready: Bool
    let version: String?
    let model: String?
    let problem: AgentProblem?

    var id: String { kind }
}

struct AgentDescriptor: Decodable, Identifiable, Equatable {
    let kind: String
    let label: String
    let vendor: String
    let bin: String
    let install: String
    let docs: String
    let models: [String]

    var id: String { kind }
    var installsWithNpm: Bool { install.hasPrefix("npm ") }
}

struct AgentState: Decodable, Equatable {
    let active: String
    let runners: [RunnerStatus]
    var catalog: [AgentDescriptor]?
}

/// What config.json holds for every surface. The extension's settings page reads and writes the same values.
struct Preferences: Decodable, Equatable {
    /// Nil until someone picks one; every paired browser shows Ember until then.
    let theme: String?
    let guardrails: GuardrailSettings
}

struct GuardrailSettings: Decodable, Equatable {
    struct Switch: Decodable, Equatable {
        let enabled: Bool
        let overridden: Bool
    }

    struct Unattended: Decodable, Equatable {
        let effect: String
        let overridden: Bool
    }

    let rules: [GuardrailRule]
    let fence: Switch
    let unattended: Unattended
    let hosts: [String]
    let configPath: String
}

struct GuardrailRule: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let reason: String
    /// The effect with nothing overridden.
    let fallback: String
    /// Present only when someone chose one.
    let choice: String?
    let locked: Bool?

    var isLocked: Bool { locked == true }

    enum CodingKeys: String, CodingKey {
        case choice = "override"
        case id, title, reason, fallback, locked
    }
}

enum RuleEffect: String, CaseIterable, Identifiable {
    case allow, confirm, deny

    var id: String { rawValue }
    var label: String {
        switch self {
        case .allow: "Allow"
        case .confirm: "Ask"
        case .deny: "Block"
        }
    }

    static func label(_ raw: String) -> String { RuleEffect(rawValue: raw)?.label ?? raw.capitalized }
}

/// A daemon answer shaped `{ ok, data }` or `{ ok, error }`, as the whole socket protocol is.
struct Outcome<Value: Decodable>: Decodable {
    struct Failure: Decodable, LocalizedError {
        let code: String
        let message: String
        var errorDescription: String? { message }
    }

    let ok: Bool
    let data: Value?
    let error: Failure?

    func value() throws -> Value {
        if ok, let data { return data }
        throw error ?? Failure(code: "MALFORMED", message: ControlError.malformed.localizedDescription)
    }
}

struct Skill: Decodable, Identifiable, Equatable {
    let name: String
    let description: String
    let triggers: [String]
    let isDefault: Bool
    let category: String
    let domains: [String]
    let source: String
    let provenance: String
    let path: String?

    var id: String { "\(source)/\(name)" }
}

struct AgentSkill: Decodable, Identifiable, Equatable {
    let name: String
    let description: String?
    var id: String { name }
}

struct SkillListing: Decodable, Equatable {
    let skills: [Skill]
    let dirs: [String]
    let agent: String
    let agentSkills: [AgentSkill]
}

struct Grant: Decodable, Identifiable, Equatable {
    let action: String
    let host: String
    let at: String
    var id: String { "\(action)@\(host)" }
}

struct GrantListing: Decodable { let grants: [Grant] }

struct DownloadRecord: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let mime: String
    let size: Int
    let url: String
    let host: String?
    let notes: String
    let savedTo: String
    let capturedAt: String
}

struct DownloadListing: Decodable, Equatable {
    let dir: String
    let downloads: [DownloadRecord]
}

struct SetupResult: Decodable {
    struct Daemon: Decodable { let port: Int; let pid: Int }
    struct Chosen: Decodable { let id: String; let opened: Bool; let connected: Bool }
    let version: String
    /// Set only when the unpacked folder was written or was already there.
    let extensionDir: String?
    let daemon: Daemon
    let alreadyPaired: Bool
    let chosen: Chosen?
    let pairingCode: String?
    let expiresAt: Double?
}

/// One browser as `browsentic browsers --json` describes it: where it gets the extension, and the copies it runs.
struct BrowserRow: Decodable, Identifiable, Equatable {
    struct Copy: Decodable, Equatable {
        let id: String
        let source: String?
        let extensionVersion: String
        let connected: Bool
    }

    let id: String
    let label: String
    let installed: Bool
    let source: String
    let store: String
    let storeUrl: String
    let steps: [String]
    let extensionsPage: String
    let connected: Bool
    let sessions: [Copy]

    var copy: Copy? { sessions.first(where: \.connected) ?? sessions.first }
    var addTitle: String { id == "firefox" ? "Get the Firefox add-on" : "Add to \(label)" }
}

struct BrowserListing: Decodable { let browsers: [BrowserRow] }

enum SourceLabel {
    static func of(_ source: String?) -> String {
        switch source {
        case "chrome-web-store": "Chrome Web Store"
        case "edge-add-ons": "Edge Add-ons"
        case "firefox": "Firefox add-on"
        default: "unpacked"
        }
    }
}

struct InstallStamp: Decodable, Equatable {
    let version: String
    let installedAt: String
}

enum Timestamp {
    private static let parser: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter
    }()

    static func date(_ text: String) -> Date? { parser.date(from: text) }

    static func ago(_ text: String, now: Date = Date()) -> String {
        guard let date = date(text) else { return text }
        return ago(date, now: now)
    }

    static func ago(_ date: Date, now: Date = Date()) -> String {
        if now.timeIntervalSince(date) < 5 { return "just now" }
        return relative.localizedString(for: date, relativeTo: now)
    }
}

enum Version {
    static func isNewer(_ candidate: String, than current: String) -> Bool {
        let release: (String) -> [Int] = { version in
            version.split(separator: "-")[0].split(separator: ".").map { Int($0) ?? 0 }
        }
        let a = release(candidate), b = release(current)
        for index in 0..<3 {
            let left = index < a.count ? a[index] : 0, right = index < b.count ? b[index] : 0
            if left != right { return left > right }
        }
        return false
    }

    static func major(_ version: String) -> Int {
        Int(version.trimmingCharacters(in: CharacterSet(charactersIn: "v \n")).split(separator: ".").first ?? "") ?? 0
    }
}
