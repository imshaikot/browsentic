import SwiftUI

/// Settings, with the pages that once had tabs of their own, picked from a sidebar that stays put while a page scrolls.
struct SettingsScreen: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(alignment: .top, spacing: 28) {
            SettingsSidebar().frame(width: 168).padding(.top, 64)
            ScrollView {
                Group {
                    switch model.settingsSection {
                    case .general: SettingsView()
                    case .agents: AgentsView()
                    case .skills: SkillsView()
                    case .activity: ActivityView()
                    case .logs: LogsView()
                    }
                }
                .padding(.top, 64)
                .padding(.bottom, 36)
                .id(model.settingsSection)
                .transition(.opacity.combined(with: .offset(y: 6)))
            }
            .scrollIndicators(.never)
        }
        .frame(maxWidth: 1076)
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity)
        .animation(.easeInOut(duration: 0.18), value: model.settingsSection)
    }
}

private struct SettingsSidebar: View {
    @EnvironmentObject private var model: AppModel
    @State private var hovered: SettingsSection?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(SettingsSection.allCases) { section in
                let selected = model.settingsSection == section
                let lit = hovered == section
                Button { model.settingsSection = section } label: {
                    HStack(spacing: 9) {
                        Image(systemName: section.icon).font(.system(size: 12, weight: .semibold)).frame(width: 16)
                        Text(section.label).font(.system(size: 13, weight: .medium))
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(selected ? Palette.brand : lit ? Palette.inkDim : Palette.inkFaint)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(
                        selected ? Palette.brand.opacity(0.12) : lit ? Palette.surface.opacity(0.6) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                    )
                    .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                .buttonStyle(.plain)
                .onHover { inside in
                    if inside { hovered = section } else if hovered == section { hovered = nil }
                }
            }
        }
    }
}
