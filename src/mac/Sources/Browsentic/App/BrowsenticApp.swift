import AppKit
import SwiftUI

@main
struct BrowsenticApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()
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
            CommandMenu("Daemon") {
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
            Image(systemName: model.daemon == .on ? "circle.hexagongrid.fill" : "circle.hexagongrid")
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_: NSApplication, hasVisibleWindows visible: Bool) -> Bool {
        if !visible { NSApp.windows.first { $0.canBecomeMain }?.makeKeyAndOrderFront(nil) }
        return true
    }
}

private struct RootView: View {
    @EnvironmentObject private var model: AppModel

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
    }
}

private struct MenuBarContent: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Text("Daemon: \(model.daemon.label)\(model.status.map { " · 127.0.0.1:\($0.port)" } ?? "")")
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
