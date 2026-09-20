import SwiftUI

struct ActivityView: View {
    @EnvironmentObject private var model: AppModel
    @State private var confirmingApprovals = false
    @State private var confirmingDownloads = false

    var body: some View {
        VStack(spacing: 18) {
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        SectionTitle(
                            title: "Standing approvals",
                            subtitle: "Every “always on this site” you have granted. These actions no longer ask on these sites."
                        )
                        Spacer()
                        if !model.grants.isEmpty {
                            Button("Forget all") { confirmingApprovals = true }.buttonStyle(QuietButtonStyle(tint: Palette.danger))
                        }
                    }
                    if model.grants.isEmpty {
                        EmptyState(icon: "checkmark.shield", title: "Nothing is pre-approved", detail: "Every gated action still asks before it runs.")
                    } else {
                        ForEach(Dictionary(grouping: model.grants, by: \.host).sorted { $0.key < $1.key }, id: \.key) { host, grants in
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(host).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink)
                                    FlowingPills(items: grants.map { "\($0.action.replacingOccurrences(of: "page.", with: "")) · \(Timestamp.ago($0.at))" })
                                }
                                Spacer()
                                Button("Forget") { Task { await model.clearApprovals(host: host) } }
                                    .buttonStyle(QuietButtonStyle())
                                    .disabled(model.busy.contains("approvals"))
                            }
                            .padding(12)
                            .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        SectionTitle(title: "Captured downloads", subtitle: "Files an agent pulled off a page. The daemon sweeps them after two weeks.")
                        Spacer()
                        if let downloads = model.downloads, !downloads.downloads.isEmpty {
                            Button("Delete all") { confirmingDownloads = true }.buttonStyle(QuietButtonStyle(tint: Palette.danger))
                        }
                    }
                    if let dir = model.downloads?.dir { PathRow(url: URL(fileURLWithPath: dir)) }
                    if let downloads = model.downloads?.downloads, !downloads.isEmpty {
                        ForEach(downloads) { download in
                            HStack(spacing: 12) {
                                Image(systemName: "doc").foregroundStyle(Palette.brand)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(download.name).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.ink).lineLimit(1)
                                    Text("\(download.notes) · \(Timestamp.ago(download.capturedAt))").font(.system(size: 11.5)).foregroundStyle(Palette.inkDim).lineLimit(1)
                                }
                                Spacer()
                                Button { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: download.savedTo)]) } label: {
                                    Label("Reveal", systemImage: "folder")
                                }
                                .buttonStyle(QuietButtonStyle())
                            }
                            .padding(12)
                            .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    } else {
                        EmptyState(icon: "arrow.down.doc", title: "Nothing captured", detail: "Files land here when an agent uses page.captureDownload.")
                    }
                }
            }
        }
        .task { await model.loadActivity() }
        .confirmationDialog("Forget every standing approval?", isPresented: $confirmingApprovals) {
            Button("Forget all", role: .destructive) { Task { await model.clearApprovals(host: nil) } }
        } message: { Text("Gated actions will ask again on every site.") }
        .confirmationDialog("Delete every captured download?", isPresented: $confirmingDownloads) {
            Button("Delete all", role: .destructive) { Task { await model.clearDownloads() } }
        } message: { Text("The files are removed from disk.") }
    }
}

private struct FlowingPills: View {
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(stride(from: 0, to: items.count, by: 3)), id: \.self) { start in
                HStack(spacing: 5) {
                    ForEach(items[start..<min(start + 3, items.count)], id: \.self) { Pill(text: $0) }
                }
            }
        }
    }
}
