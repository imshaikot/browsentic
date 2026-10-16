import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue
    @AppStorage("startDaemonOnLaunch") private var startOnLaunch = true
    @State private var confirmingUninstall = false
    @State private var keepSkills = true

    private var mcpCommand: String { "claude mcp add browsentic -- \(Paths.mcpShim.path)" }

    var body: some View {
        VStack(spacing: 18) {
            UpdateCard()

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
                        title: "Turn Browsentic Bridge on when the app opens",
                        subtitle: "It keeps running after the window closes, so the side panel and MCP clients still work.",
                        isOn: $startOnLaunch
                    )
                }
            }

            PairingCard()

            BrowserSettings()

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
                HStack(spacing: 16) {
                    SectionTitle(title: "Uninstall", subtitle: "Stops Browsentic Bridge, unpairs every browser, and removes the command, the unpacked extension, keys, approvals and logs.")
                    Spacer(minLength: 0)
                    Button("Uninstall…") { confirmingUninstall = true }.buttonStyle(QuietButtonStyle(tint: Palette.danger))
                }
            }
        }
        .onAppear { model.refreshCommandLink() }
        .sheet(isPresented: $confirmingUninstall) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Uninstall Browsentic?").font(.display(18)).foregroundStyle(Palette.ink)
                Text("This stops Browsentic Bridge, unpairs every browser, and removes ~/.browsentic and ~/browsentic — the command, the unpacked extension, keys, approvals and logs.\n\nRemove Browsentic from each browser first: right-click its toolbar icon and choose Remove. Then drag this app to the Trash.")
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

private struct PairingCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle(title: "Pairing", subtitle: subtitle)
                VStack(spacing: 6) {
                    ForEach(PairingMode.allCases) { mode in
                        PairingOption(mode: mode, selected: model.pairingMode == mode) {
                            Task { await model.setPairingMode(mode) }
                        }
                    }
                }
                .disabled(model.pairingMode == nil || model.busy.contains("pairing"))
            }
        }
    }

    private var subtitle: String {
        if model.daemon != .on { return "Turn Browsentic Bridge on to choose how browsers connect to it." }
        if model.status != nil, !model.bridgePairs { return "Restart Browsentic Bridge to choose how browsers connect to it." }
        return "How a browser with Browsentic connects to Browsentic Bridge on this Mac."
    }
}

private struct PairingOption: View {
    let mode: PairingMode
    let selected: Bool
    let choose: () -> Void
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 11, style: .continuous)
        Button(action: choose) {
            HStack(spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 14))
                    .foregroundStyle(selected ? Palette.brand : Palette.inkFaint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(mode.label).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink)
                    Text(mode.detail).font(.system(size: 11.5)).foregroundStyle(Palette.inkDim)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(selected ? Palette.brand.opacity(0.1) : Palette.ground2, in: shape)
            .overlay(shape.strokeBorder(selected ? Palette.brand.opacity(0.45) : Palette.line))
            .opacity(enabled ? 1 : 0.55)
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
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
