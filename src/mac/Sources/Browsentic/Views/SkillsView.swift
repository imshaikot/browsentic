import SwiftUI

struct SkillsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var query = ""

    private var shown: [Skill] {
        let skills = model.skills?.skills ?? []
        guard !query.isEmpty else { return skills }
        return skills.filter { "\($0.name) \($0.description) \($0.domains.joined(separator: " "))".localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        VStack(spacing: 18) {
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        SectionTitle(
                            title: "Skills the agent can route to",
                            subtitle: "Read in order — a later folder shadows an earlier one by name. Drop a folder with a SKILL.md into yours to add one."
                        )
                        Spacer()
                        Button { Task { await model.loadSkills() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                            .buttonStyle(QuietButtonStyle())
                    }
                    ForEach(model.skills?.dirs ?? [], id: \.self) { dir in
                        PathRow(url: URL(fileURLWithPath: (dir as NSString).expandingTildeInPath))
                    }
                    TextField("Filter by name, description or site", text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13))
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.line))
                }
            }

            if model.skills == nil {
                ProgressView().padding(40)
            } else if shown.isEmpty {
                EmptyState(icon: "book.closed", title: "No skill matches", detail: "Clear the filter to see all of them.")
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    ForEach(shown) { SkillTile(skill: $0) }
                }
            }

            if let own = model.skills?.agentSkills, !own.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionTitle(title: "The agent’s own skills", subtitle: "Attachable from the side panel’s / picker.")
                        ForEach(own) { skill in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(skill.name).font(.code(12, weight: .semibold)).foregroundStyle(Palette.ink)
                                if let description = skill.description, !description.isEmpty {
                                    Text(description).font(.system(size: 11.5)).foregroundStyle(Palette.inkDim).lineLimit(2)
                                }
                            }
                        }
                    }
                }
            }
        }
        .task { await model.loadSkills() }
    }
}

private struct SkillTile: View {
    let skill: Skill

    private var tint: Color {
        switch skill.source {
        case "bundled": Palette.brand
        case "user": Palette.ember
        default: Palette.magenta
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(skill.name).font(.code(12.5, weight: .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                Spacer(minLength: 4)
                if skill.isDefault { Pill(text: "default", tint: Palette.lime) }
                Pill(text: skill.provenance == "generated" ? "mapped" : skill.source, tint: tint)
            }
            Text(skill.description.isEmpty ? "No description." : skill.description)
                .font(.system(size: 12))
                .foregroundStyle(Palette.inkDim)
                .lineLimit(3)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
            HStack(spacing: 6) {
                ForEach(skill.domains.prefix(2), id: \.self) { Pill(text: $0, icon: "globe") }
                Spacer()
                if let path = skill.path {
                    Button { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) } label: {
                        Image(systemName: "folder")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.inkDim)
                    .help("Reveal in Finder")
                }
            }
        }
        .padding(14)
        .background(Palette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.line))
    }
}
