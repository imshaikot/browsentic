import SwiftUI

struct LogsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var following = true

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    SectionTitle(title: "Daemon log", subtitle: Paths.tilde(Paths.log))
                    Spacer()
                    Toggle("Follow", isOn: $following).toggleStyle(.switch).controlSize(.small).tint(Palette.brand)
                        .font(.system(size: 12)).foregroundStyle(Palette.inkDim)
                    CopyButton(value: model.logText, label: "Copy all")
                    Button { NSWorkspace.shared.activateFileViewerSelecting([Paths.log]) } label: { Label("Reveal", systemImage: "folder") }
                        .buttonStyle(QuietButtonStyle())
                }
                .padding(16)
                Divider().overlay(Palette.line)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 1) {
                            ForEach(Array(model.logText.split(whereSeparator: \.isNewline).enumerated()), id: \.offset) { _, line in
                                LogLine(text: String(line))
                            }
                            Color.clear.frame(height: 1).id("end")
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: 470)
                    .background(Palette.ground2.opacity(0.6))
                    .onChange(of: model.logText) { if following { proxy.scrollTo("end", anchor: .bottom) } }
                    .onAppear { proxy.scrollTo("end", anchor: .bottom) }
                }
            }
        }
        .task {
            while !Task.isCancelled {
                model.loadLog()
                try? await Task.sleep(nanoseconds: 1_500_000_000)
            }
        }
    }
}

private struct LogLine: View {
    let text: String

    var body: some View {
        let split = text.firstIndex(of: " ")
        let stamp = split.map { String(text[..<$0]) } ?? ""
        let message = split.map { String(text[text.index(after: $0)...]) } ?? text
        let time = stamp.count >= 19 && stamp.contains("T") ? String(stamp.dropFirst(11).prefix(8)) : stamp
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(time).foregroundStyle(Palette.inkFaint)
            Text(message).foregroundStyle(tint(message)).textSelection(.enabled)
        }
        .font(.code(11))
    }

    private func tint(_ message: String) -> Color {
        let lowered = message.lowercased()
        if lowered.contains("rejected") || lowered.contains("error") || lowered.contains("failed") { return Palette.danger }
        if lowered.contains("drifted") || lowered.contains("revoked") { return Palette.amber }
        if lowered.contains("connected") || lowered.contains("paired") || lowered.contains("listening") { return Palette.lime }
        return Palette.inkDim
    }
}
