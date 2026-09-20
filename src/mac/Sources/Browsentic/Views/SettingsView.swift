import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue
    @AppStorage("startDaemonOnLaunch") private var startOnLaunch = true
    @State private var confirmingUninstall = false
    @State private var keepSkills = true

    private static let installLine = "curl -fsSL https://browsentic.com/install.sh | sh"

    private var mcpCommand: String { "claude mcp add browsentic -- \(Paths.mcpShim.path)" }

    var body: some View {
        VStack(spacing: 18) {
            if let latest = model.latestRelease {
                Card {
                    HStack(spacing: 14) {
                        Image(systemName: "arrow.down.circle.fill").font(.system(size: 22)).foregroundStyle(Palette.brand)
                        SectionTitle(title: "Browsentic \(latest) is out", subtitle: "You have \(model.appVersion). Paste this into a terminal and it replaces the app, which then replaces the command and the extension: \(Self.installLine)")
                        Spacer()
                        CopyButton(value: Self.installLine, label: "Copy the line")
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 14) {
                    SectionTitle(title: "Appearance")
                    Picker("Appearance", selection: $appearance) {
                        ForEach(Appearance.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                    Divider().overlay(Palette.line)
                    SwitchRow(
                        title: "Turn the daemon on when the app opens",
                        subtitle: "It keeps running after the window closes, so the side panel and MCP clients still work.",
                        isOn: $startOnLaunch
                    )
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 12) {
                    SwitchRow(
                        title: "“browsentic” in your terminal",
                        subtitle: model.commandDir.map { "Linked in \(Paths.tilde(URL(fileURLWithPath: $0))). Everything this window does, the command does too." }
                            ?? "Links the command into a folder already on your PATH. No password, and no shell profile is edited.",
                        isOn: Binding(get: { model.commandDir != nil }, set: { model.setCommandLink($0) })
                    )
                    if let foreign = model.foreignCommand {
                        Label("Another browsentic is already on your PATH at \(foreign). Remove it with “npm rm -g browsentic” so the two cannot disagree.", systemImage: "exclamationmark.triangle")
                            .font(.system(size: 11.5))
                            .foregroundStyle(Palette.amber)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    PathRow(url: Paths.shim)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(title: "Optional: use it from an MCP client", subtitle: "The same browser tools, handed to Claude Code or any other MCP client. The side panel does not need this.")
                    HStack {
                        Text(mcpCommand).font(.code(11.5)).foregroundStyle(Palette.ink).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                        Spacer()
                        CopyButton(value: mcpCommand)
                    }
                    .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 6)
                    .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.line))
                    if let token = model.lock?.token {
                        HStack {
                            Text("Control token").font(.system(size: 12)).foregroundStyle(Palette.inkDim)
                            Text(String(repeating: "•", count: 24)).font(.code(11)).foregroundStyle(Palette.inkFaint)
                            Spacer()
                            CopyButton(value: token, label: "Copy token")
                        }
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(title: "About", subtitle: "Browsentic \(model.appVersion) · free and open source, MIT.")
                    HStack(spacing: 8) {
                        Button("browsentic.com") { NSWorkspace.shared.open(URL(string: "https://browsentic.com")!) }.buttonStyle(QuietButtonStyle())
                        Button("Source") { NSWorkspace.shared.open(URL(string: "https://github.com/imshaikot/browsentic")!) }.buttonStyle(QuietButtonStyle())
                        Button("Run the checks again") { model.phase = .preflight; Task { await model.runPreflight() } }.buttonStyle(QuietButtonStyle())
                        Spacer()
                        Button("Uninstall…") { confirmingUninstall = true }.buttonStyle(QuietButtonStyle(tint: Palette.danger))
                    }
                }
            }
        }
        .onAppear { model.refreshCommandLink() }
        .sheet(isPresented: $confirmingUninstall) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Uninstall Browsentic?").font(.display(18)).foregroundStyle(Palette.ink)
                Text("This stops the daemon, unpairs every browser, and removes ~/.browsentic and ~/browsentic — the command, the unpacked extension, keys, approvals and logs.\n\nRemove the Browsentic card at chrome://extensions first, then drag this app to the Trash afterwards.")
                    .font(.system(size: 12.5)).foregroundStyle(Palette.inkDim).fixedSize(horizontal: false, vertical: true)
                Toggle("Keep my skills and site maps", isOn: $keepSkills).toggleStyle(.checkbox)
                HStack {
                    Spacer()
                    Button("Cancel") { confirmingUninstall = false }.buttonStyle(QuietButtonStyle())
                    Button("Uninstall") {
                        confirmingUninstall = false
                        Task { await model.uninstall(keepSkills: keepSkills) }
                    }
                    .buttonStyle(PrimaryButtonStyle(tint: Palette.danger))
                }
            }
            .padding(24)
            .frame(width: 440)
            .background(Palette.ground)
        }
    }
}

private struct SwitchRow: View {
    let title: String
    let subtitle: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 16) {
            SectionTitle(title: title, subtitle: subtitle)
            Spacer(minLength: 0)
            Toggle(title, isOn: $isOn).toggleStyle(.switch).labelsHidden().tint(Palette.brand)
        }
    }
}
