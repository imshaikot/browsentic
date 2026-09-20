import SwiftUI

struct AgentsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 18) {
            if model.daemon != .on {
                OfflineHint(what: "Agent readiness checks")
            } else if let agents = model.agents {
                Card {
                    SectionTitle(
                        title: "Which agent runs the side panel",
                        subtitle: "Browsentic ships no model and needs no API key. It drives the agent CLI you are already signed in to."
                    )
                }
                ForEach(agents.runners) { runner in
                    AgentCard(
                        runner: runner, descriptor: agents.catalog?.first { $0.kind == runner.kind },
                        active: agents.active == runner.kind
                    )
                }
            } else {
                ProgressView().padding(60)
            }
        }
        .task(id: model.daemon) { if model.daemon == .on { await model.loadAgents() } }
    }
}

private struct AgentCard: View {
    @EnvironmentObject private var model: AppModel
    let runner: RunnerStatus
    let descriptor: AgentDescriptor?
    let active: Bool

    private var working: Bool { model.busy.contains("agent:\(runner.kind)") }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Image(systemName: active ? "largecircle.fill.circle" : "circle")
                        .font(.system(size: 18))
                        .foregroundStyle(active ? Palette.brand : Palette.inkFaint)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            Text(descriptor?.label ?? runner.kind.capitalized).font(.display(16)).foregroundStyle(Palette.ink)
                            if let vendor = descriptor?.vendor { Text(vendor).font(.system(size: 11.5)).foregroundStyle(Palette.inkFaint) }
                        }
                        Text(runner.ready ? (runner.version ?? "Ready") : "Unavailable")
                            .font(.code(11.5))
                            .foregroundStyle(runner.ready ? Palette.inkDim : Palette.amber)
                    }
                    Spacer()
                    if working { ProgressView().controlSize(.small) }
                    if active { Pill(text: "In use", tint: Palette.brand, icon: "checkmark") }
                    else if runner.ready {
                        Button("Use this agent") { Task { await model.selectAgent(runner.kind) } }
                            .buttonStyle(QuietButtonStyle())
                            .disabled(working)
                    }
                }

                if let problem = runner.problem {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(problem.message).font(.system(size: 12.5)).foregroundStyle(Palette.inkDim).fixedSize(horizontal: false, vertical: true)
                        if let fix = problem.fix {
                            Text(fix).font(.code(11.5)).foregroundStyle(Palette.ink).textSelection(.enabled)
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        HStack(spacing: 8) {
                            if problem.code == "AGENT_MISSING", let descriptor {
                                Button { Task { await model.installAgent(descriptor) } } label: {
                                    Label(descriptor.installsWithNpm ? "Install \(descriptor.label)" : "Open the install guide", systemImage: "arrow.down.circle")
                                }
                                .buttonStyle(PrimaryButtonStyle())
                                .disabled(working)
                            }
                            if problem.grantable == true {
                                Button { Task { await model.repairAgent(runner.kind) } } label: { Label("Fix it for me", systemImage: "wand.and.stars") }
                                    .buttonStyle(PrimaryButtonStyle())
                                    .disabled(working)
                            }
                            if let docs = descriptor.flatMap({ URL(string: $0.docs) }) {
                                Button("Docs") { NSWorkspace.shared.open(docs) }.buttonStyle(QuietButtonStyle())
                            }
                        }
                    }
                    .padding(.leading, 30)
                } else if let descriptor {
                    HStack(spacing: 10) {
                        Text("Model").font(.system(size: 12)).foregroundStyle(Palette.inkDim)
                        Picker("Model", selection: Binding(
                            get: { runner.model ?? "" },
                            set: { picked in Task { await model.setModel(picked.isEmpty ? nil : picked, for: runner.kind) } }
                        )) {
                            Text("The CLI’s own default").tag("")
                            ForEach(Array(Set(descriptor.models + [runner.model].compactMap { $0 })).sorted { a, b in
                                (descriptor.models.firstIndex(of: a) ?? .max) < (descriptor.models.firstIndex(of: b) ?? .max)
                            }, id: \.self) { Text($0).tag($0) }
                        }
                        .labelsHidden()
                        .frame(width: 240)
                        .disabled(working)
                    }
                    .padding(.leading, 30)
                }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(active ? Palette.brand.opacity(0.5) : .clear))
    }
}
