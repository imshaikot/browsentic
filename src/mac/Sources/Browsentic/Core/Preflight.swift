import AppKit
import Foundation

enum CheckID: String, CaseIterable, Identifiable {
    case system, node, command, extensionFiles, browser, agent

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "This Mac"
        case .node: "Node.js runtime"
        case .command: "Browsentic command"
        case .extensionFiles: "Browser extension"
        case .browser: "A Chromium browser"
        case .agent: "An AI agent"
        }
    }

    var icon: String {
        switch self {
        case .system: "laptopcomputer"
        case .node: "hexagon"
        case .command: "terminal"
        case .extensionFiles: "puzzlepiece.extension"
        case .browser: "globe"
        case .agent: "sparkles"
        }
    }

    /// What "Set up everything" installs on its own. A browser and an agent are the user's pick.
    var installsAutomatically: Bool { self == .node || self == .command || self == .extensionFiles }
    var blocksEntry: Bool { installsAutomatically }
}

enum CheckState: Equatable {
    case waiting
    case checking
    case passed(String)
    case missing(String)
    case advisory(String)
    case working(Double?, String)
    case failed(String)

    var isPassed: Bool { if case .passed = self { true } else { false } }
    var needsAttention: Bool {
        switch self {
        case .missing, .failed: true
        default: false
        }
    }
}

struct Browser: Identifiable, Equatable {
    let name: String
    let bundleId: String
    let url: URL

    var id: String { bundleId }

    static let known: [(String, String)] = [
        ("Google Chrome", "com.google.Chrome"),
        ("Brave", "com.brave.Browser"),
        ("Microsoft Edge", "com.microsoft.edgemac"),
        ("Arc", "company.thebrowser.Browser"),
        ("Vivaldi", "com.vivaldi.Vivaldi"),
        ("Opera", "com.operasoftware.Opera"),
        ("Chromium", "org.chromium.Chromium"),
    ]

    static func installed() -> [Browser] {
        known.compactMap { name, bundleId in
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId).map { Browser(name: name, bundleId: bundleId, url: $0) }
        }
    }

    /// Chrome refuses chrome:// URLs from the command line, but takes them over Apple Events.
    @discardableResult
    func openExtensionsPage() -> Bool {
        let source = "tell application id \"\(bundleId)\"\nactivate\nopen location \"chrome://extensions\"\nend tell"
        var error: NSDictionary?
        NSAppleScript(source: source)?.executeAndReturnError(&error)
        if error != nil { NSWorkspace.shared.openApplication(at: url, configuration: .init()) }
        return error == nil
    }
}

enum AgentProbe {
    static let bins = [("Claude Code", "claude"), ("Codex", "codex"), ("Antigravity", "agy"), ("Mistral Vibe", "vibe"), ("Grok Build", "grok")]

    static func installed() -> [String] {
        bins.filter { Shell.which($0.1) != nil }.map(\.0)
    }
}

enum ExtensionFiles {
    static func stamp() -> InstallStamp? {
        let url = Paths.extensionDir().appendingPathComponent(".browsentic-install.json")
        return (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(InstallStamp.self, from: $0) }
    }
}
