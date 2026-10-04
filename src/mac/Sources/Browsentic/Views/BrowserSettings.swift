import SwiftUI

/// The settings every paired browser shares, kept by the daemon in config.json. The extension's own
/// settings page edits the same values, and a change on either side shows up on the other at once.
struct BrowserSettings: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if model.daemon != .on {
            OfflineHint(what: "The browser theme and the guardrails")
        } else if model.preferencesUnsupported {
            StaleDaemonHint()
        } else if let preferences = model.preferences {
            BrowserThemeCard(selected: BrowserTheme(rawValue: preferences.theme ?? "") ?? .ember)
            GuardrailsCard(settings: preferences.guardrails)
        } else {
            Card { ProgressView().controlSize(.small).frame(maxWidth: .infinity) }
        }
    }
}

private struct StaleDaemonHint: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Card {
            HStack(spacing: 14) {
                Image(systemName: "arrow.clockwise.circle").font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.amber)
                SectionTitle(
                    title: "Browsentic Bridge predates this app",
                    subtitle: "It is still running from before the last update, so it cannot share the browser theme or the guardrails yet."
                )
                Spacer()
                Button("Restart it") { Task { await model.restartDaemon() } }.buttonStyle(PrimaryButtonStyle())
            }
        }
    }
}

private struct BrowserThemeCard: View {
    @EnvironmentObject private var model: AppModel
    let selected: BrowserTheme

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle(
                    title: "Browser theme",
                    subtitle: "How the side panel, the popup and the extension’s settings page look in every paired browser. This window keeps its own appearance."
                )
                HStack(spacing: 10) {
                    ForEach(BrowserTheme.allCases) { theme in
                        ThemeTile(theme: theme, selected: theme == selected) {
                            Task { await model.setBrowserTheme(theme) }
                        }
                    }
                }
                .disabled(model.busy.contains("theme"))
            }
        }
    }
}

private struct ThemeTile: View {
    let theme: BrowserTheme
    let selected: Bool
    let pick: () -> Void

    var body: some View {
        let swatch = theme.swatches
        Button(action: pick) {
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Capsule().fill(swatch.ink.opacity(0.75)).frame(width: 52, height: 4)
                    Capsule().fill(swatch.ink.opacity(0.3)).frame(width: 34, height: 4)
                    HStack(spacing: 4) {
                        ForEach(Array(([swatch.brand] + swatch.accents).enumerated()), id: \.offset) { _, color in
                            Circle().fill(color).frame(width: 7, height: 7)
                        }
                    }
                    .padding(.top, 4)
                }
                .padding(9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(swatch.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                HStack(spacing: 6) {
                    Text(theme.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(swatch.ink)
                    Spacer(minLength: 0)
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(selected ? swatch.brand : swatch.inkFaint)
                }
                Text(theme.note)
                    .font(.system(size: 10.5))
                    .foregroundStyle(swatch.inkFaint)
                    .lineLimit(2, reservesSpace: true)
            }
            .padding(10)
            .background(swatch.ground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(selected ? swatch.brand.opacity(0.7) : Palette.line, lineWidth: selected ? 1.5 : 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(theme.name) browser theme")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct GuardrailsCard: View {
    @EnvironmentObject private var model: AppModel
    let settings: GuardrailSettings

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                SectionTitle(
                    title: "Guardrails",
                    subtitle: "What the agent may do without asking you first. Each row starts on the default Browsentic ships; switch one on to choose Allow, Ask or Block. A run takes its policy when it starts."
                )

                RowGroup(rows: settings.rules.filter { !$0.isLocked }.map { rule in
                    AnyView(RuleRow(rule: rule))
                })

                RowGroup(title: "Everything else", rows: [
                    AnyView(SwitchRow(
                        id: "fence",
                        title: "Fence page text",
                        note: "Wraps every page result in a marker telling the model it is reading data, never instructions.",
                        state: settings.fence.overridden ? (settings.fence.enabled ? "On" : "Off") : "On (default)",
                        overridden: settings.fence.overridden,
                        whenOn: settings.fence.enabled
                    ) {
                        Picker("Fence page text", selection: Binding(
                            get: { settings.fence.enabled },
                            set: { value in Task { await model.setGuardrail("fence", to: value) } }
                        )) {
                            Text("Fence").tag(true)
                            Text("Do not fence").tag(false)
                        }
                    }),
                    AnyView(SwitchRow(
                        id: "unattended",
                        title: "Callers with nobody to ask",
                        note: "An MCP client outside the side panel cannot answer a prompt. This is what its “Ask” decisions become.",
                        state: settings.unattended.overridden ? RuleEffect.label(settings.unattended.effect) : "Block (default)",
                        overridden: settings.unattended.overridden,
                        whenOn: settings.unattended.effect
                    ) {
                        Picker("Callers with nobody to ask", selection: Binding(
                            get: { settings.unattended.effect },
                            set: { value in Task { await model.setGuardrail("unattended", to: value) } }
                        )) {
                            Text("Block").tag("deny")
                            Text("Allow").tag("allow")
                        }
                    }),
                ])

                RowGroup(title: "Not switches", rows: [AnyView(FactRow(
                    icon: "checkmark.shield.fill",
                    title: "Credential sealing",
                    badge: "Always on",
                    note: "Passwords, keys, tokens and cookies are replaced by a placeholder before a result leaves the browser."
                ))] + settings.rules.filter(\.isLocked).map { rule in
                    AnyView(FactRow(icon: "lock.fill", title: rule.title, badge: RuleEffect.label(rule.fallback), note: rule.reason))
                })

                if !settings.hosts.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Standing host allowlist").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkDim)
                        Text(settings.hosts.joined(separator: " · ")).font(.code(11)).foregroundStyle(Palette.inkFaint).textSelection(.enabled)
                    }
                }

                PathRow(url: URL(fileURLWithPath: settings.configPath))
            }
        }
    }
}

private struct RowGroup: View {
    var title: String?
    let rows: [AnyView]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title.uppercased()).font(.code(10)).tracking(1.2).foregroundStyle(Palette.inkFaint)
            }
            VStack(spacing: 0) {
                ForEach(rows.indices, id: \.self) { index in
                    if index > 0 { Divider().overlay(Palette.line) }
                    rows[index]
                }
            }
            .background(Palette.ground2.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line))
        }
    }
}

private struct RuleRow: View {
    @EnvironmentObject private var model: AppModel
    let rule: GuardrailRule

    var body: some View {
        SwitchRow(
            id: rule.id,
            title: rule.title,
            note: rule.reason,
            state: rule.choice.map(RuleEffect.label) ?? "\(RuleEffect.label(rule.fallback)) (default)",
            overridden: rule.choice != nil,
            whenOn: rule.choice ?? rule.fallback
        ) {
            Picker(rule.title, selection: Binding(
                get: { rule.choice ?? rule.fallback },
                set: { value in Task { await model.setGuardrail(rule.id, to: value) } }
            )) {
                ForEach(RuleEffect.allCases) { Text($0.label).tag($0.rawValue) }
            }
        }
    }
}

/// A row that uses the shipped default until switched on, and then offers its choices underneath.
private struct SwitchRow<Value: Sendable, Choices: View>: View {
    @EnvironmentObject private var model: AppModel
    let id: String
    let title: String
    let note: String
    let state: String
    let overridden: Bool
    /// What switching the row on writes: the value it already resolves to, so nothing changes until a choice is made.
    let whenOn: Value
    @ViewBuilder let choices: Choices

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.ink)
                Text(note).font(.system(size: 11.5)).foregroundStyle(Palette.inkFaint).fixedSize(horizontal: false, vertical: true)
                if overridden {
                    choices.pickerStyle(.segmented).labelsHidden().fixedSize().padding(.top, 6)
                }
            }
            Spacer(minLength: 0)
            Text(state.uppercased())
                .font(.code(10))
                .tracking(0.8)
                .foregroundStyle(overridden ? Palette.brand : Palette.inkFaint)
                .padding(.top, 2)
            if model.busy.contains("guardrail:\(id)") {
                ProgressView().controlSize(.small).frame(width: 34)
            } else {
                Toggle(title, isOn: Binding(
                    get: { overridden },
                    set: { on in Task { await model.setGuardrail(id, to: on ? whenOn as Any : nil) } }
                ))
                .toggleStyle(.switch)
                .labelsHidden()
                .controlSize(.small)
                .tint(Palette.brand)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(overridden ? Palette.brand.opacity(0.06) : .clear)
    }
}

private struct FactRow: View {
    let icon: String
    let title: String
    let badge: String
    let note: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.inkFaint)
                Text(title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.inkDim)
                Spacer(minLength: 0)
                Text(badge.uppercased()).font(.code(10)).tracking(0.8).foregroundStyle(Palette.inkFaint)
            }
            Text(note).font(.system(size: 11.5)).foregroundStyle(Palette.inkFaint).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }
}
