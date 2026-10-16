import AppKit
import SwiftUI

@main
struct BrowsenticApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel.shared
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue

    private var scheme: ColorScheme? { Appearance(rawValue: appearance)?.scheme }

    var body: some Scene {
        Window("Browsentic", id: "main") {
            RootView()
                .environmentObject(model)
                .preferredColorScheme(scheme)
                .frame(minWidth: 940, minHeight: 680)
                .task { await model.runPreflight() }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1040, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("View") {
                ForEach(Array(Tab.allCases.enumerated()), id: \.element) { index, tab in
                    Button(tab.label) { model.tab = tab }
                        .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
                        .disabled(model.phase != .main)
                }
            }
            CommandMenu("Bridge") {
                Button(model.daemon == .on ? "Turn Off" : "Turn On") { Task { await model.setDaemon(on: model.daemon == .off) } }
                    .keyboardShortcut("d", modifiers: [.command, .shift])
                    .disabled(model.phase != .main || (model.daemon != .on && model.daemon != .off))
                Button("Restart") { Task { await model.restartDaemon() } }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                    .disabled(model.daemon != .on)
                Divider()
                Button("New Pairing Code") {
                    model.tab = .browsers
                    Task { await model.newPairingCode() }
                }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .disabled(model.daemon != .on)
            }
        }

        MenuBarExtra {
            MenuBarContent().environmentObject(model)
        } label: {
            Image(nsImage: model.pendingRequests.isEmpty ? (model.daemon == .on ? MenuBarMark.on : MenuBarMark.off) : MenuBarMark.asking)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// A notification that launches the app is delivered before launch finishes, so the delegate has to be in place first.
    func applicationWillFinishLaunching(_: Notification) {
        PairingAlerts.shared.install()
    }

    /// The Bridge starts the app with `--pairing`, in the background, when a browser asks and nobody is watching.
    func applicationDidFinishLaunching(_: Notification) {
        if CommandLine.arguments.contains("--pairing") { AppModel.shared.startPolling() }
    }

    /// Notification permission can change in System Settings while the app is away.
    func applicationDidBecomeActive(_: Notification) {
        Task { await AppModel.shared.reportNotices() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_: NSApplication, hasVisibleWindows visible: Bool) -> Bool {
        if !visible { NSApp.windows.first { $0.canBecomeMain }?.makeKeyAndOrderFront(nil) }
        return true
    }
}

private struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ZStack(alignment: .bottom) {
            switch model.phase {
            case .preflight: PreflightView().transition(.opacity.combined(with: .scale(scale: 1.03)))
            case .main: MainView().transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
            if let notice = model.notice {
                NoticeBanner(notice: notice)
                    .padding(.bottom, 22)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { Backdrop() }
        .sheet(item: Binding(get: { model.pendingRequests.first }, set: { _ in })) { request in
            PairRequestSheet(request: request).environmentObject(model)
        }
        .onAppear { model.openMainWindow = { openWindow(id: "main") } }
    }
}

private struct MenuBarContent: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ForEach(model.pendingRequests) { request in
            Button("\(request.name) wants to connect…") {
                openWindow(id: "main")
                NSApp.activate()
            }
        }
        if !model.pendingRequests.isEmpty { Divider() }
        Text("Browsentic Bridge: \(model.daemon.label)\(model.status.map { " · 127.0.0.1:\($0.port)" } ?? "")")
        if let status = model.status {
            Text(status.connected ? "Extension connected" : "Extension not connected")
        }
        Divider()
        Button(model.daemon == .on ? "Turn Off" : "Turn On") { Task { await model.setDaemon(on: model.daemon == .off) } }
            .disabled(model.phase != .main || (model.daemon != .on && model.daemon != .off))
        Button("Restart") { Task { await model.restartDaemon() } }.disabled(model.daemon != .on)
        Divider()
        Button("Open Browsentic") {
            openWindow(id: "main")
            NSApp.activate(ignoringOtherApps: true)
        }
        Button("Quit") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
