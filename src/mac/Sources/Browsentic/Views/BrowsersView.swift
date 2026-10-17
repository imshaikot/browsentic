import SwiftUI

struct BrowsersView: View {
    @EnvironmentObject private var model: AppModel
    @State private var confirmingAll = false

    var body: some View {
        VStack(spacing: 18) {
            if model.daemon != .on {
                OfflineHint(what: "Paired browsers")
            } else {
                ConnectCard()
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            SectionTitle(title: "Paired browsers", subtitle: "Each one holds a key of its own. Unpairing drops the key, disconnects it at once and keeps it out until you reconnect it.")
                            Spacer()
                            if model.sessions.count > 1 {
                                Button("Unpair all") { confirmingAll = true }.buttonStyle(QuietButtonStyle(tint: Palette.danger))
                            }
                        }
                        if model.sessions.isEmpty {
                            EmptyState(icon: "globe", title: "No browser is paired", detail: emptyDetail)
                        } else {
                            ForEach(model.sessions) { SessionRow(session: $0) }
                        }
                    }
                }
                if !model.blocked.isEmpty { KeptOutCard() }
            }
        }
        .confirmationDialog("Unpair every browser?", isPresented: $confirmingAll) {
            Button("Unpair all", role: .destructive) { Task { await model.revoke(nil) } }
        } message: { Text("They won’t reconnect by themselves until you reconnect them.") }
    }

    private var emptyDetail: String {
        switch model.pairingMode {
        case .auto: "Add the extension from the Overview tab and it connects by itself."
        case .ask: "Add the extension from the Overview tab, then allow it here when it asks to connect."
        default: "Add the extension from the Overview tab, or get a code above and enter it in the Browsentic side panel."
        }
    }
}

private struct SessionRow: View {
    @EnvironmentObject private var model: AppModel
    let session: BrowserSession
    @State private var confirming = false
    @State private var renaming = false

    var body: some View {
        HStack(spacing: 12) {
            GlowDot(color: session.connected ? Palette.lime : Palette.inkFaint, pulsing: session.connected)
            VStack(alignment: .leading, spacing: 3) {
                if let name = session.name {
                    HStack(spacing: 6) {
                        Text(name).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink)
                        if let browser = session.browser, session.label != nil, browser != name {
                            Text(browser).font(.system(size: 12)).foregroundStyle(Palette.inkFaint)
                        }
                    }
                }
                if !session.extensionId.isEmpty {
                    Text(session.extensionId).font(.code(12)).foregroundStyle(session.name == nil ? Palette.ink : Palette.inkDim).textSelection(.enabled)
                }
                Text("\(session.paired.label) \(Timestamp.ago(session.pairedAt)) · \(SourceLabel.of(session.source)) · v\(session.extensionVersion) · seen \(Timestamp.ago(session.lastSeenAt))")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Palette.inkDim)
            }
            Spacer()
            Pill(text: session.connected ? "Connected" : "Away", tint: session.connected ? Palette.lime : Palette.inkDim)
            if model.bridgePairs, session.sessionId != nil {
                Button("Rename") { renaming = true }
                    .buttonStyle(QuietButtonStyle())
                    .disabled(model.busy.contains("label:\(session.id)"))
            }
            Button("Unpair") { confirming = true }
                .buttonStyle(QuietButtonStyle(tint: Palette.danger))
                .disabled(model.busy.contains("revoke"))
        }
        .padding(12)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .confirmationDialog("Unpair \(session.displayName)?", isPresented: $confirming) {
            Button("Unpair", role: .destructive) { Task { await model.revoke(session) } }
        } message: { Text("It won’t reconnect by itself until you reconnect it.") }
        .sheet(isPresented: $renaming) { RenameSheet(session: session).environmentObject(model) }
    }
}

private struct RenameSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let session: BrowserSession
    @State private var name: String

    init(session: BrowserSession) {
        self.session = session
        _name = State(initialValue: session.name ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Rename \(session.displayName)").font(.display(18)).foregroundStyle(Palette.ink)
            Text("A name of your own tells two profiles of one browser apart. Leave it empty to go back to \(session.browser ?? "the browser’s own name").")
                .font(.system(size: 12.5))
                .foregroundStyle(Palette.inkDim)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Name", text: $name, prompt: Text(session.browser ?? "Name"))
                .textFieldStyle(.roundedBorder)
                .labelsHidden()
                .onSubmit(save)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(QuietButtonStyle())
                Button("Save", action: save).buttonStyle(PrimaryButtonStyle()).keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 420)
        .background(Palette.ground)
    }

    private func save() {
        dismiss()
        Task { await model.rename(session, to: name) }
    }
}

private struct KeptOutCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle(title: "Kept out", subtitle: "Browsers you unpaired or denied. They won’t connect by themselves until you reconnect them.")
                ForEach(model.blocked) { BlockedRow(browser: $0) }
            }
        }
    }
}

private struct BlockedRow: View {
    @EnvironmentObject private var model: AppModel
    let browser: BlockedBrowser

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "hand.raised.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.inkFaint).frame(width: 8)
            VStack(alignment: .leading, spacing: 3) {
                Text(browser.name).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink)
                Text("\(browser.why) \(Timestamp.ago(browser.at)) · install \(browser.shortId)")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Palette.inkDim)
            }
            Spacer()
            Button("Reconnect") { Task { await model.reconnect(browser) } }
                .buttonStyle(QuietButtonStyle(tint: Palette.brand))
                .disabled(model.busy.contains("reconnect:\(browser.id)"))
        }
        .padding(12)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
