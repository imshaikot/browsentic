import SwiftUI

struct AboutView: View {
    @EnvironmentObject private var model: AppModel

    private var versions: [About.Row] {
        let status = model.status
        let daemonVersion = status?.daemonVersion ?? model.lock?.daemonVersion
        let loaded = status?.connected == true ? status?.extensionVersion.map { "\($0) connected" } : nil
        let rows: [About.Row?] = [
            About.Row(label: "App", value: model.appVersion),
            About.Row(label: "Command", value: Payload.installedVersion ?? "not installed"),
            About.Row(label: "Bridge", value: daemonVersion.map { [$0, status.map { "port \($0.port)" }].compactMap { $0 }.joined(separator: " · ") } ?? "off"),
            status.map { About.Row(label: "Protocol", value: String($0.protocolVersion)) },
            About.Row(label: "Extension", value: [model.stamp.map { "\($0.version) unpacked" }, loaded ?? "not connected"].compactMap { $0 }.joined(separator: " · ")),
            About.agent(model.agents).map { About.Row(label: "Agent", value: $0) },
            model.node.map { About.Row(label: "Node.js", value: $0.version) },
            About.Row(label: "System", value: About.system),
        ]
        return rows.compactMap { $0 }
    }

    var body: some View {
        let rows = versions
        let environment = About.describe(rows)

        VStack(spacing: 18) {
            Card {
                HStack(spacing: 16) {
                    BrandMark().frame(width: 48, height: 48)
                    SectionTitle(title: "Browsentic", subtitle: "\(model.appVersion) · your browser’s superpower · free and open source, Apache 2.0.")
                    Spacer(minLength: 0)
                    LinkButton(title: "browsentic.com", url: About.Link.site)
                    LinkButton(title: "Source", url: About.Link.repository)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 16) {
                        SectionTitle(title: "Made by \(About.author)", subtitle: "Builds and maintains Browsentic.")
                        Spacer(minLength: 0)
                        LinkButton(title: "GitHub profile", url: About.Link.author)
                    }
                    Divider().overlay(Palette.line)
                    HStack(spacing: 16) {
                        Image(systemName: "star.fill").font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.amber)
                        SectionTitle(title: "Star it on GitHub", subtitle: About.starAsk)
                        Spacer(minLength: 0)
                        Button { NSWorkspace.shared.open(About.Link.repository) } label: { Label("Star", systemImage: "star") }
                            .buttonStyle(PrimaryButtonStyle())
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 14) {
                    SectionTitle(
                        title: "Versions",
                        subtitle: "What this Mac is running. Report a bug opens GitHub’s issue form with these filled in; nothing is sent until you submit it there."
                    )
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                            if index > 0 { Divider().overlay(Palette.line) }
                            HStack(spacing: 16) {
                                Text(row.label).font(.system(size: 12)).foregroundStyle(Palette.inkDim).frame(width: 96, alignment: .leading)
                                Text(row.value).font(.code(11.5)).foregroundStyle(Palette.ink).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                        }
                    }
                    .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.line))
                    HStack(spacing: 8) {
                        CopyButton(value: environment)
                        LinkButton(title: "Report a bug", icon: "ladybug", url: About.bugReport(environment: environment, agent: About.agent(model.agents)))
                        LinkButton(title: "Suggest a feature", icon: "lightbulb", url: About.Link.feature)
                    }
                }
            }

            Card(padding: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    SectionTitle(title: "Help")
                        .padding(.horizontal, 20)
                        .padding(.top, 20)
                        .padding(.bottom, 8)
                    HelpRow(icon: "book", title: "Guide", detail: "Installing, pairing, the agents, and every feature step by step.", url: About.Link.guide)
                    HelpRow(icon: "macwindow", title: "This app", detail: "Every tab of this window, the menu bar item, updates and uninstalling.", url: About.Link.macApp)
                    HelpRow(icon: "lifepreserver", title: "Troubleshooting", detail: "Symptom, cause and fix for setup, pairing, agents and pages.", url: About.Link.troubleshooting)
                    HelpRow(icon: "doc.text", title: "Release notes", detail: "What changed in each version.", url: About.Link.changelog)
                    Divider().overlay(Palette.line)
                    Button {
                        model.phase = .preflight
                        Task { await model.runPreflight() }
                    } label: {
                        Label("Run the checks again", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(QuietButtonStyle())
                    .padding(.horizontal, 20)
                    .padding(.vertical, 14)
                }
            }
        }
    }
}

private struct LinkButton: View {
    let title: String
    var icon = "arrow.up.right"
    let url: URL

    var body: some View {
        Button { NSWorkspace.shared.open(url) } label: { Label(title, systemImage: icon) }
            .buttonStyle(QuietButtonStyle())
    }
}

private struct HelpRow: View {
    let icon: String
    let title: String
    let detail: String
    let url: URL
    @State private var hovered = false

    var body: some View {
        Button { NSWorkspace.shared.open(url) } label: {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.brand).frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink)
                    Text(detail).font(.system(size: 12)).foregroundStyle(Palette.inkDim)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(hovered ? Palette.inkDim : Palette.inkFaint)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 11)
            .background(hovered ? Palette.surface2.opacity(0.6) : .clear)
            .overlay(alignment: .top) { Rectangle().fill(Palette.line).frame(height: 1) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}
