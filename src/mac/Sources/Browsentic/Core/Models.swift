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
    let extensionVersion: String
    let pairedAt: String
    let lastSeenAt: String
    let connected: Bool

    enum CodingKeys: String, CodingKey {
        case sessionId = "id"
        case browser, origin, extensionVersion, pairedAt, lastSeenAt, connected
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
    let version: String
    let extensionDir: String
    let daemon: Daemon
    let alreadyPaired: Bool
    let pairingCode: String?
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
