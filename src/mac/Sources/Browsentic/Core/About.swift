import Foundation

enum About {
    static let author = "imshaikot"
    static let starAsk = "Browsentic is free and open source — no API key, no subscription, no account. A star on GitHub is how the next person finds it."

    enum Link {
        static let author = URL(string: "https://github.com/imshaikot")!
        static let repository = URL(string: "https://github.com/imshaikot/browsentic")!
        static let site = URL(string: "https://browsentic.com")!
        static let guide = URL(string: "https://browsentic.com/docs/guide/")!
        static let macApp = URL(string: "https://browsentic.com/docs/guide/mac-app/")!
        static let troubleshooting = URL(string: "https://browsentic.com/docs/guide/troubleshooting/")!
        static let changelog = URL(string: "https://browsentic.com/changelog/")!
        static let feature = URL(string: "https://github.com/imshaikot/browsentic/issues/new?template=capability.yml")!
    }

    struct Row: Identifiable, Equatable {
        let label: String
        let value: String
        var id: String { label }
    }

    static var system: String {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let chip = NodeRuntime.architecture == "arm64" ? "Apple silicon" : "Intel"
        return "macOS \(os.majorVersion).\(os.minorVersion) · \(chip)"
    }

    static func describe(_ rows: [Row]) -> String {
        rows.map { "\($0.label) \($0.value)" }.joined(separator: " · ")
    }

    static func agent(_ state: AgentState?) -> String? {
        guard let state, let runner = state.runners.first(where: { $0.kind == state.active }) else { return nil }
        let label = state.catalog?.first { $0.kind == runner.kind }?.label ?? runner.kind
        let release = runner.version.map { version in
            version.range(of: #"\d+(?:\.\d+)+(?:[-+][\w.]+)?"#, options: .regularExpression).map { String(version[$0]) } ?? version
        }
        return [label, release].compactMap { $0 }.joined(separator: " ")
    }

    static func bugReport(environment: String, agent: String?) -> URL {
        var components = URLComponents(url: Link.repository.appendingPathComponent("issues/new"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "template", value: "bug_report.yml"), URLQueryItem(name: "environment", value: environment)]
            + (agent.map { [URLQueryItem(name: "agent", value: $0)] } ?? [])
        // URLComponents leaves “+” as is, and GitHub reads it as a space.
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return components.url!
    }
}
