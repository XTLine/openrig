import { assertRedacted, previewBinding, previewHarness, templateCore } from "./helpers/runtime-preview.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StubRuntimeAdapter } from "../src/adapters/stub-runtime-adapter.js";
import { TerminalAdapter } from "../src/adapters/terminal-adapter.js";

const opts = Object.freeze({ name: "private-seat" });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Stub and terminal fresh previews", () => {
  it.each(["floor", "full_bypass"] as const)("matches the captured %s stub runner without creating identity or state", async launchPosture => {
    const h = previewHarness();
    const adapter = new StubRuntimeAdapter({ tmux: h.tmux, fsOps: h.fs,
      runnerEntryPath: "/private-runner", newLaunchId: h.identity });
    const binding = previewBinding({ launchPosture });
    const preview = await adapter.previewLaunch(binding, opts);
    h.untouched();
    await adapter.launchHarness(binding, opts);
    expect(templateCore(preview)).toBe(h.sendText.mock.calls[0]![1]
      .replaceAll("/private-runner", "<runner-entry>").replaceAll("rig-test-dev-seat", "<session-name>")
      .replaceAll("/private-cwd", "<cwd>").replaceAll("private-launch-id", "<launch-id>"));
    expect(preview.commandTemplate).not.toMatch(/model|effort|--session /);
  });

  it("does not create a hermetic stub launch record or invent a command", async () => {
    const h = previewHarness();
    const adapter = new StubRuntimeAdapter({ tmux: h.tmux, newLaunchId: h.identity });
    const preview = await adapter.previewLaunch(previewBinding(), opts);
    h.untouched(); assertRedacted(preview);
    expect(preview.commandTemplate).toBeNull();
    expect(preview.warnings.join(" ")).toContain("in-memory");
    expect((await adapter.checkReady(previewBinding())).ready).toBe(false);
  });

  it("explicitly describes terminal as a no-command harness without running startup actions", async () => {
    const adapter = new TerminalAdapter();
    const launch = vi.spyOn(adapter, "launchHarness"), delivery = vi.spyOn(adapter, "deliverStartup");
    const preview = await adapter.previewLaunch(previewBinding(), opts);
    expect(launch).not.toHaveBeenCalled(); expect(delivery).not.toHaveBeenCalled();
    assertRedacted(preview); expect(preview.commandTemplate).toBeNull();
    expect(preview.warnings.join(" ")).toContain("Startup actions are separate");
  });
});
