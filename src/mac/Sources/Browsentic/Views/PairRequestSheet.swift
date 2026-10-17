import SwiftUI

/// The one place a pairing request can always be answered, whatever happened to the notification.
struct PairRequestSheet: View {
    @EnvironmentObject private var model: AppModel
    let request: PairRequest
    @State private var name: String

    init(request: PairRequest) {
        self.request = request
        _name = State(initialValue: request.browser ?? "")
    }

    private var deciding: Bool { model.busy.contains("decide:\(request.id)") }
    private var waitingAfter: Int { max(0, model.pendingRequests.count - 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "puzzlepiece.extension.fill")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(Palette.brand)
                    .frame(width: 44, height: 44)
                    .background(Palette.brand.opacity(0.13), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(request.name) wants to connect to Browsentic Bridge")
                        .font(.display(17))
                        .foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Allow it to use your agent and drive this browser? If you didn’t just install or open Browsentic in \(request.browser ?? "a browser"), don’t allow it.")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Palette.inkDim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 7) {
                DetailRow(label: "From", value: SourceLabel.of(request.source).capitalizedFirst)
                DetailRow(label: "Version", value: "v\(request.extensionVersion)")
                DetailRow(label: "Install", value: request.shortId, code: true)
                DetailRow(label: "Asked", value: Timestamp.ago(request.askedAt))
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line))

            VStack(alignment: .leading, spacing: 6) {
                Text("Name").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Palette.inkDim)
                TextField("Name", text: $name, prompt: Text(request.name))
                    .textFieldStyle(.roundedBorder)
                    .labelsHidden()
                Text("Tells two profiles of one browser apart in the Browsers tab.")
                    .font(.system(size: 11))
                    .foregroundStyle(Palette.inkFaint)
            }

            HStack(spacing: 10) {
                if waitingAfter > 0 {
                    Text("\(waitingAfter) more waiting").font(.system(size: 11.5)).foregroundStyle(Palette.inkDim)
                }
                Spacer()
                Button("Deny") { Task { await model.decide(request, allow: false) } }
                    .buttonStyle(QuietButtonStyle(tint: Palette.danger))
                Button("Allow") { Task { await model.decide(request, allow: true, name: name) } }
                    .buttonStyle(PrimaryButtonStyle())
                    .keyboardShortcut(.defaultAction)
            }
            .disabled(deciding)
        }
        .padding(24)
        .frame(width: 470)
        .background(Palette.ground)
        .interactiveDismissDisabled()
    }
}

private struct DetailRow: View {
    let label: String
    let value: String
    var code = false

    var body: some View {
        GridRow {
            Text(label).font(.system(size: 11.5)).foregroundStyle(Palette.inkFaint)
            Text(value)
                .font(code ? .code(11.5) : .system(size: 12, weight: .medium))
                .foregroundStyle(Palette.ink)
                .textSelection(.enabled)
        }
    }
}
