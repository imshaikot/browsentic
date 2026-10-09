import AppKit
import SwiftUI

enum Phase { case preflight, main }

enum DaemonPhase: Equatable {
    case off, starting, on, stopping

    var label: String {
        switch self {
        case .off: "Off"
        case .starting: "Starting"
        case .on: "Running"
        case .stopping: "Stopping"
        }
    }
}

enum Tab: String, CaseIterable, Identifiable {
    case overview, browsers, android, agents, skills, activity, logs, settings, about

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var icon: String {
        switch self {
        case .overview: "power"
        case .browsers: "globe"
        case .android: "candybarphone"
        case .agents: "sparkles"
        case .skills: "book.closed"
        case .activity: "checkmark.shield"
        case .logs: "text.alignleft"
        case .settings: "gearshape"
        case .about: "info.circle"
        }
    }
}

struct Notice: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let isError: Bool
}

@MainActor
final class AppModel: ObservableObject {
    @Published var phase: Phase = .preflight
    @Published var tab: Tab = .overview
    @Published var checks: [CheckID: CheckState] = Dictionary(uniqueKeysWithValues: CheckID.allCases.map { ($0, .waiting) })
    @Published var preflightBusy = true
    @Published var fixing = false

    @Published var daemon: DaemonPhase = .off
    @Published var lock: Lockfile?
    @Published var status: BridgeStatus?
    @Published var sessions: [BrowserSession] = []
    @Published var pairing: PairingCode?
    @Published var agents: AgentState?
    /// `browsentic android --json` while the Android tab is open; the Bridge looks for phones only then.
    @Published var android: AndroidState?
    @Published var preferences: Preferences?
    /// The running daemon never answered for its settings: it predates this app and needs a restart.
    @Published var preferencesUnsupported = false
    @Published var skills: SkillListing?
    @Published var grants: [Grant] = []
    @Published var downloads: DownloadListing?
    @Published var stamp: InstallStamp?
    @Published var browsers: [Browser] = []
    /// Every browser `browsentic browsers` knows, where it gets the extension, and the copies it runs.
    @Published var browserRows: [BrowserRow] = []
    @Published var logText = ""
    @Published var commandDir: String?
    @Published var foreignCommand: String?
    @Published var update: AppRelease?
    @Published var updatePhase: UpdatePhase = .idle
    @Published var lastUpdateCheck: Date?
    @Published var busy: Set<String> = []
    @Published var notice: Notice?

    private(set) var node: NodeInstall?
    private let control = ControlClient()
    private var poller: Task<Void, Never>?
    private var eventWatcher: Task<Void, Never>?
    private var updateWatcher: Task<Void, Never>?
    private var watchingAndroid = false

    var cli: CLI? { node.map(CLI.init) }
    var appVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? Payload.bundledVersion ?? "dev" }
    /// Only an unpacked copy waits for ↻: a store copy updates when its browser says.
    var extensionNeedsReload: Bool {
        guard let stamp else { return false }
        return sessions.contains { $0.connected && $0.source == "unpacked" && $0.extensionVersion != stamp.version }
    }

    /// The browsers worth a row: found on this Mac or already paired, else the usual few to try.
    var offeredBrowsers: [BrowserRow] {
        let found = browserRows.filter { $0.installed || !$0.sessions.isEmpty }
        return found.isEmpty ? browserRows.filter { ["chrome", "edge", "brave", "firefox"].contains($0.id) } : found
    }

    // MARK: Preflight

    func runPreflight() async {
        preflightBusy = true
        for id in CheckID.allCases { checks[id] = .waiting }
        for id in CheckID.allCases {
            checks[id] = .checking
            async let settle: Void = Self.pause(0.42)
            let state = await evaluate(id)
            await settle
            withAnimation(.spring(duration: 0.45)) { checks[id] = state }
        }
        preflightBusy = false
        if finishingUpdate() {
            await setUpEverything()
            if phase == .main { say("Browsentic \(appVersion) is installed.") }
            return
        }
        if CheckID.allCases.filter(\.blocksEntry).allSatisfy({ checks[$0]?.isPassed == true }),
           !CheckID.allCases.contains(where: { checks[$0]?.needsAttention == true }) {
            await Self.pause(0.9)
            enter()
        }
    }

    var canEnter: Bool { CheckID.allCases.filter(\.blocksEntry).allSatisfy { checks[$0]?.isPassed == true } }
    var needsSetup: Bool { CheckID.allCases.contains { $0.installsAutomatically && checks[$0]?.isPassed != true } }

    private func evaluate(_ id: CheckID) async -> CheckState {
        switch id {
        case .system:
            return .passed(About.system)
        case .node:
            node = await NodeRuntime.locate()
            guard let node else { return .missing("Version \(NodeRuntime.minimumMajor) or newer runs Browsentic Bridge. A private copy goes in \(Paths.tilde(Paths.runtime)).") }
            return .passed("\(node.version) · \(node.isPrivate ? "private copy" : Paths.tilde(URL(fileURLWithPath: node.path)))")
        case .command:
            guard let bundled = Payload.bundledVersion else { return .failed(PayloadError.missing.localizedDescription) }
            if Payload.isCurrent { return .passed("v\(bundled) in \(Paths.tilde(Paths.cli))") }
            if let installed = Payload.installedVersion, installed != bundled {
                return .missing("v\(installed) is installed; this app carries v\(bundled).")
            }
            return .missing("Installs the command and what runs in the background into \(Paths.tilde(Paths.cli)).")
        case .browser:
            browsers = Browser.installed()
            return browsers.isEmpty
                ? .advisory("None found. Chrome, Brave, Edge, Arc, Vivaldi, Opera or Firefox all work.")
                : .passed(browsers.map(\.name).joined(separator: ", "))
        case .agent:
            let found = AgentProbe.installed()
            return found.isEmpty
                ? .advisory("None on your PATH. The side panel needs Claude Code, Codex, Antigravity, Mistral Vibe or Grok Build.")
                : .passed(found.joined(separator: ", "))
        }
    }

    /// After an in-app update the new bundle carries a newer command and extension than the ones
    /// on disk, and the person already asked for them by pressing Update.
    private func finishingUpdate() -> Bool {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: AppUpdater.finishKey) else { return false }
        defaults.removeObject(forKey: AppUpdater.finishKey)
        return checks[.command]?.isPassed != true && checks[.node]?.isPassed == true
    }

    func setUpEverything() async {
        fixing = true
        defer { fixing = false }
        for id in CheckID.allCases where id.installsAutomatically && checks[id]?.isPassed != true {
            guard await fix(id) else { return }
        }
        if canEnter {
            await Self.pause(0.7)
            enter()
        }
    }

    @discardableResult
    func fix(_ id: CheckID) async -> Bool {
        do {
            switch id {
            case .node:
                checks[id] = .working(0, "Starting")
                node = try await NodeRuntime.installPrivate { fraction, label in
                    Task { @MainActor [weak self] in self?.checks[.node] = .working(fraction, label) }
                }
            case .command:
                guard let node else { throw CLIError.failed("Node.js has to be installed first.") }
                checks[id] = .working(nil, "Copying Browsentic Bridge into \(Paths.tilde(Paths.cli))")
                let wasRunning = FileManager.default.fileExists(atPath: Paths.lockfile.path)
                try await Task.detached { try Payload.install(node: node) }.value
                if wasRunning {
                    checks[id] = .working(nil, "Restarting Browsentic Bridge on the new build")
                    try await CLI(node: node).restart()
                }
                checks[id] = .working(nil, "Letting your browsers start it")
                _ = try await CLI(node: node).registerBridge()
            case .agent:
                guard let node else { throw CLIError.failed("Node.js has to be installed first.") }
                checks[id] = .working(nil, "npm i -g @anthropic-ai/claude-code")
                let result = await Shell.run(node.npm, ["install", "-g", "@anthropic-ai/claude-code"], extraPath: [node.binDir], timeout: 600)
                guard result.ok else { throw CLIError.failed(String(result.failure.suffix(400))) }
            case .browser:
                NSWorkspace.shared.open(URL(string: "https://www.google.com/chrome/")!)
                return true
            case .system:
                return true
            }
            let state = await evaluate(id)
            withAnimation(.spring(duration: 0.45)) { checks[id] = state }
            return state.isPassed
        } catch {
            withAnimation { checks[id] = .failed(error.localizedDescription) }
            return false
        }
    }

    func enter() {
        withAnimation(.easeInOut(duration: 0.6)) { phase = .main }
        startPolling()
        Task {
            refreshCommandLink()
            if UserDefaults.standard.object(forKey: "startDaemonOnLaunch") as? Bool ?? true, daemon == .off { await setDaemon(on: true) }
            await loadBrowsers()
        }
        watchForUpdates()
    }

    // MARK: Daemon

    func startPolling() {
        eventWatcher?.cancel()
        eventWatcher = Task { [weak self, control] in
            for await event in control.events {
                switch event {
                case "settings-changed":
                    await self?.loadPreferences()
                    await self?.loadAgents()
                case "android-changed":
                    await self?.loadAndroid()
                default:
                    break
                }
            }
        }
        poller?.cancel()
        poller = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    func refresh() async {
        guard let lock = Self.readLock() else { return markOff() }
        if await control.connect(lock) {
            Task { await self.loadPreferences(watch: true) }
            if watchingAndroid { Task { await self.watchAndroid(true) } }
        }
        do {
            let status = try await control.status()
            let sessions = try await control.sessions()
            let changed = sessions.map { "\($0.id):\($0.connected)" } != self.sessions.map { "\($0.id):\($0.connected)" }
            self.lock = lock
            self.status = status
            self.sessions = sessions
            if daemon != .stopping { daemon = .on }
            if pairing != nil, !status.pairingPending || (pairing?.expiry ?? .distantPast) < Date() { pairing = nil }
            if agents == nil { await loadAgents() }
            stamp = ExtensionFiles.stamp()
            if changed { Task { await loadBrowsers() } }
        } catch {
            await control.close()
            markOff()
        }
    }

    private func markOff() {
        guard daemon != .starting else { return }
        daemon = .off
        lock = nil
        status = nil
        sessions = []
        pairing = nil
        preferences = nil
    }

    private static func readLock() -> Lockfile? {
        (try? Data(contentsOf: Paths.lockfile)).flatMap { try? JSONDecoder().decode(Lockfile.self, from: $0) }
    }

    func setDaemon(on: Bool) async {
        guard let cli, daemon == (on ? .off : .on) else { return }
        daemon = on ? .starting : .stopping
        do {
            if on { try await cli.start() } else {
                await control.close()
                try await cli.stop()
            }
        } catch { report(error) }
        daemon = on ? .starting : .off
        if !on { markOff() }
        await refresh()
        if on, daemon == .starting { daemon = .off }
    }

    func restartDaemon() async {
        await perform("restart") { cli, _ in
            self.daemon = .starting
            await self.control.close()
            try await cli.restart()
            self.agents = nil
        }
        await refresh()
        if daemon == .starting { daemon = .off }
    }

    // MARK: Operations

    func newPairingCode() async {
        await perform("pair") { _, control in self.pairing = try await control.pair() }
    }

    func revoke(_ session: BrowserSession?) async {
        await perform("revoke") { _, control in
            let count = try await control.revoke(session)
            self.say(count == 0 ? "Nothing to unpair." : "Unpaired \(count) browser\(count == 1 ? "" : "s").")
        }
        await refresh()
    }

    func loadAgents() async {
        guard let cli else { return }
        if let state = try? await cli.agents() { agents = state }
    }

    /// The tab subscribes while it shows and lets go when it leaves, so phones are looked for only while someone is looking at them.
    func watchAndroid(_ on: Bool) async {
        watchingAndroid = on
        guard daemon == .on else { return }
        _ = try? await control.android(watch: on)
        if on { await loadAndroid() }
    }

    func loadAndroid() async {
        await perform("android", quiet: true) { cli, _ in self.android = try await cli.android() }
    }

    func openChrome(on serial: String) async {
        await perform("android:\(serial)") { cli, control in
            _ = try await control.android(launch: serial)
            self.android = try await cli.android()
        }
    }

    func loadPreferences(watch: Bool = false) async {
        do {
            preferences = try await control.preferences(watch: watch)
            preferencesUnsupported = false
        } catch ControlError.timeout {
            preferencesUnsupported = true
        } catch {}
    }

    func setBrowserTheme(_ theme: BrowserTheme) async {
        await perform("theme") { _, control in self.preferences = try await control.setTheme(theme) }
    }

    func setGuardrail(_ setting: String, to value: Any?) async {
        await perform("guardrail:\(setting)") { _, control in self.preferences = try await control.setGuardrail(setting, to: value) }
    }

    func selectAgent(_ kind: String) async {
        await perform("agent:\(kind)") { _, control in
            let state = try await control.agent(set: kind)
            self.agents = AgentState(active: state.active, runners: state.runners, catalog: self.agents?.catalog)
        }
    }

    func repairAgent(_ kind: String) async {
        await perform("agent:\(kind)") { _, control in
            let state = try await control.agent(grant: kind)
            self.agents = AgentState(active: state.active, runners: state.runners, catalog: self.agents?.catalog)
        }
    }

    func setModel(_ model: String?, for kind: String) async {
        await perform("agent:\(kind)") { cli, _ in
            try await cli.setModel(model, for: kind)
            self.agents = try await cli.agents()
        }
    }

    func installAgent(_ descriptor: AgentDescriptor) async {
        guard descriptor.installsWithNpm, let node else {
            if let url = URL(string: descriptor.install) { NSWorkspace.shared.open(url) }
            return
        }
        await perform("agent:\(descriptor.kind)") { cli, _ in
            let package = descriptor.install.split(separator: " ").last.map(String.init) ?? ""
            let result = await Shell.run(node.npm, ["install", "-g", package], extraPath: [node.binDir], timeout: 600)
            guard result.ok else { throw CLIError.failed(String(result.failure.suffix(400))) }
            self.agents = try await cli.agents()
            self.say("\(descriptor.label) is installed. Run “\(descriptor.bin)” in a terminal once to sign in.")
        }
    }

    func loadSkills() async {
        await perform("skills", quiet: true) { cli, _ in self.skills = try await cli.skills() }
    }

    func loadActivity() async {
        await perform("activity", quiet: true) { cli, _ in
            self.grants = try await cli.approvals()
            self.downloads = try await cli.downloads()
        }
    }

    func clearApprovals(host: String?) async {
        await perform("approvals") { cli, _ in
            try await cli.clearApprovals(host: host)
            self.grants = try await cli.approvals()
        }
    }

    func clearDownloads() async {
        await perform("downloads") { cli, _ in
            try await cli.clearDownloads()
            self.downloads = try await cli.downloads()
        }
    }

    func loadBrowsers() async {
        guard let cli, let rows = try? await cli.browsers() else { return }
        browserRows = rows
    }

    /// Opens the browser's store page in that browser and hands out the code its popup asks for. The
    /// command opens it where it found the browser; anywhere else, the app opens it itself.
    func addExtension(_ row: BrowserRow) async {
        await perform("add:\(row.id)") { cli, _ in
            let result = try await cli.addExtension(to: row.id)
            if result.chosen?.opened != true, let url = URL(string: row.storeUrl) { self.open(url, in: row) }
            if let code = result.pairingCode, let expiresAt = result.expiresAt { self.pairing = PairingCode(code: code, expiresAt: expiresAt) }
            self.say("\(row.steps.first ?? "") Then click Browsentic in \(row.label)’s toolbar and enter the code below.")
        }
    }

    private func open(_ url: URL, in row: BrowserRow) {
        if let app = browsers.first(where: { $0.name.localizedCaseInsensitiveContains(row.label) }) {
            NSWorkspace.shared.open([url], withApplicationAt: app.url, configuration: NSWorkspace.OpenConfiguration())
        } else {
            NSWorkspace.shared.open(url)
        }
    }

    func reinstallExtension() async {
        await perform("extension") { cli, _ in
            let result = try await cli.installExtension(force: true)
            self.stamp = ExtensionFiles.stamp()
            self.say("Extension v\(result.version) written. Press ↻ on its card at chrome://extensions.")
        }
    }

    func openExtensionsPage(in browser: Browser) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Paths.extensionDir().path, forType: .string)
        browser.openExtensionsPage()
        say("The extension path is on your clipboard — in the folder picker press ⇧⌘G and paste it.")
    }

    func loadLog() {
        guard let handle = try? FileHandle(forReadingFrom: Paths.log) else { return logText = "" }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        try? handle.seek(toOffset: size > 96_000 ? size - 96_000 : 0)
        let text = String(decoding: (try? handle.readToEnd()) ?? Data(), as: UTF8.self)
        let trimmed = size > 96_000 ? String(text.drop { !$0.isNewline }.dropFirst()) : text
        if trimmed != logText { logText = trimmed }
    }

    func refreshCommandLink() {
        commandDir = CommandLink.linkedIn
        foreignCommand = CommandLink.foreign
    }

    func setCommandLink(_ on: Bool) {
        do {
            if on { say("“browsentic” now runs from any terminal — linked in \(Paths.tilde(URL(fileURLWithPath: try CommandLink.link()))).") }
            else { CommandLink.unlink() }
        } catch { report(error) }
        refreshCommandLink()
    }

    func uninstall(keepSkills: Bool) async {
        await perform("uninstall") { cli, control in
            await control.close()
            CommandLink.unlink()
            _ = try await cli.uninstall(keepSkills: keepSkills)
            self.poller?.cancel()
            self.updateWatcher?.cancel()
            self.markOff()
            self.phase = .preflight
        }
        await runPreflight()
    }

    // MARK: Updates

    private func watchForUpdates() {
        updateWatcher?.cancel()
        updateWatcher = Task { [weak self] in
            while !Task.isCancelled {
                await self?.checkForUpdate()
                try? await Task.sleep(nanoseconds: 6 * 3_600 * 1_000_000_000)
            }
        }
    }

    func checkForUpdate(announce: Bool = false) async {
        guard updatePhase == .idle else { return }
        updatePhase = .checking
        defer { if updatePhase == .checking { updatePhase = .idle } }
        do {
            let found = try await UpdateFeed.latest(after: appVersion)
            lastUpdateCheck = Date()
            if let found, found.version != update?.version {
                say("Browsentic \(found.version) is out — you have \(appVersion). Update from the Overview tab.")
            } else if announce, found == nil {
                say("Browsentic \(appVersion) is the latest.")
            }
            update = found
        } catch {
            if announce { report(error) }
        }
    }

    func installUpdate() async {
        guard let update, update.hasMacBuild, !updatePhase.isInstalling else { return }
        updatePhase = .downloading(0)
        do {
            let (staged, destination) = try await AppUpdater.stage(update) { phase in
                Task { @MainActor [weak self] in
                    if self?.updatePhase.isInstalling == true { self?.updatePhase = phase }
                }
            }
            updatePhase = .relaunching
            try AppUpdater.relaunch(into: staged, at: destination)
            UserDefaults.standard.set(true, forKey: AppUpdater.finishKey)
            NSApp.terminate(nil)
        } catch {
            updatePhase = .failed(error.localizedDescription)
        }
    }

    func dismissUpdateFailure() {
        if case .failed = updatePhase { updatePhase = .idle }
    }

    // MARK: Plumbing

    private func perform(_ key: String, quiet: Bool = false, _ work: @escaping (CLI, ControlClient) async throws -> Void) async {
        guard let cli, !busy.contains(key) else { return }
        busy.insert(key)
        defer { busy.remove(key) }
        do { try await work(cli, control) } catch { if !quiet { report(error) } }
    }

    func say(_ text: String) { show(Notice(text: text, isError: false)) }
    func report(_ error: Error) { show(Notice(text: error.localizedDescription, isError: true)) }

    private func show(_ notice: Notice) {
        withAnimation(.spring(duration: 0.4)) { self.notice = notice }
        Task {
            try? await Task.sleep(nanoseconds: notice.isError ? 7_000_000_000 : 4_500_000_000)
            if self.notice == notice { withAnimation { self.notice = nil } }
        }
    }

    private static func pause(_ seconds: Double) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }
}
