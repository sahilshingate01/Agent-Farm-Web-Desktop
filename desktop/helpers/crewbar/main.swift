// crewbar — the Agent Farm menu bar extra.
//
// A deliberately tiny NSStatusItem owner: the desktop shell's SDK doesn't
// expose its tray API to app code yet, so this helper carries the menu bar
// surface instead. It renders whatever the controller writes to
// ~/.claude-farm/crewbar.json (falling back to ~/.usage-farm) and re-reads
// it every 30 seconds:
//
//   {
//     "title": "17.5h",
//     "lines": [{ "label": "gmail — 92% session · weekly 66%" }, ...],
//     "updatedAt": "..."
//   }
//
// Menu actions: each line is informational; the footer offers Open Agent
// Farm (activates the app) and Refresh (runs the controller's usage ping).
// Build: swiftc -O -o crewbar main.swift

import AppKit
import Foundation

struct CrewbarLine: Decodable {
    let label: String
}

struct CrewbarState: Decodable {
    let title: String?
    let lines: [CrewbarLine]?
    let updatedAt: String?
}

final class Crewbar: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?

    private var stateURL: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let current = home.appendingPathComponent(".claude-farm/crewbar.json")
        if FileManager.default.fileExists(atPath: current.path) { return current }
        return home.appendingPathComponent(".usage-farm/crewbar.json")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    private func refresh() {
        var state: CrewbarState? = nil
        if let data = try? Data(contentsOf: stateURL) {
            state = try? JSONDecoder().decode(CrewbarState.self, from: data)
        }
        statusItem.button?.title = "⌾ " + (state?.title ?? "farm")

        let menu = NSMenu()
        // Info rows must stay full-contrast: AppKit dims action-less items
        // unless autoenables is off and the item opts in.
        menu.autoenablesItems = false
        for line in state?.lines ?? [] {
            let item = NSMenuItem(title: line.label, action: nil, keyEquivalent: "")
            item.isEnabled = true
            item.attributedTitle = NSAttributedString(
                string: line.label,
                attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .regular)]
            )
            menu.addItem(item)
        }
        if let updated = state?.updatedAt, !updated.isEmpty {
            let item = NSMenuItem(title: "updated \(updated)", action: nil, keyEquivalent: "")
            item.isEnabled = true
            item.attributedTitle = NSAttributedString(
                string: "updated \(updated)",
                attributes: [
                    .font: NSFont.systemFont(ofSize: 11),
                    .foregroundColor: NSColor.secondaryLabelColor,
                ]
            )
            menu.addItem(item)
        }
        if !(state?.lines ?? []).isEmpty { menu.addItem(.separator()) }
        menu.addItem(withTitle: "Open Agent Farm", action: #selector(openApp), keyEquivalent: "o").target = self
        menu.addItem(withTitle: "Refresh crew", action: #selector(pingCrew), keyEquivalent: "r").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit crewbar", action: #selector(quit), keyEquivalent: "q").target = self
        statusItem.menu = menu
    }

    @objc private func openApp() {
        // Activate the running shell; fall back to launching the packaged app.
        let running = NSWorkspace.shared.runningApplications.first {
            $0.localizedName?.contains("Agensis") == true || $0.bundleIdentifier == "dev.usage-farm.desktop"
        }
        if let app = running {
            app.activate()
        } else {
            NSWorkspace.shared.launchApplication("Agensis Farm")
        }
    }

    @objc private func pingCrew() {
        // The controller path rides in the environment when the shell spawns
        // us; absent that, the ping is skipped rather than guessed.
        guard let controller = ProcessInfo.processInfo.environment["CREWBAR_CONTROLLER"] else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", controller, "farm.usage.ping", "{}"]
        try? process.run()
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.refresh() }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // menu bar only — no Dock icon
let delegate = Crewbar()
app.delegate = delegate
app.run()
