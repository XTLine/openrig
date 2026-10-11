import { assertRedacted, previewBinding, previewHarness, templateCore } from "./helpers/runtime-preview.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiRuntimeAdapter } from "../src/adapters/pi-runtime-adapter.js";
import { OmpRuntimeAdapter } from "../src/adapters/omp-runtime-adapter.js";
import type { SeatLaunchEnvironment } from "../src/domain/seat-launch-environment.js";

const opts = Object.freeze({ name: "private-seat" });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

for (const Adapter of [PiRuntimeAdapter, OmpRuntimeAdapter]) describe(`${Adapter.name} fresh preview`, () => {
  it.each(["floor", "full_bypass"] as const)("matches the actual %s runner command without provisioning state", async launchPosture => {
    const h = previewHarness();
    const adapter = new Adapter({ tmux: h.tmux, fsOps: h.fs, stateRoot: "/private-state",
      runnerEntryPath: "/private-runner", newLaunchId: h.identity });
    const binding = previewBinding({ launchPosture });
    const preview = await adapter.previewLaunch(binding, opts);
    h.untouched();
    await adapter.launchHarness(binding, opts);
    expect(templateCore(preview)).toBe(h.sendShellCommand.mock.calls[0]![1]
      .replaceAll("/private-runner", "<runner-entry>").replaceAll("rig-test-dev-seat", "<session-name>")
      .replaceAll("/private-state", "<state-root>").replaceAll("/private-cwd", "<cwd>")
      .replaceAll("private-launch-id", "<launch-id>").replaceAll("private-model", "<model>"));
    expect(preview.commandTemplate).not.toContain("effort");
  });

  it("keeps runtime-specific environment routing and credentials out of the preview", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "private-provider-secret");
    const h = previewHarness();
    const adapter = new Adapter({ tmux: h.tmux, fsOps: h.fs, stateRoot: "/private-state",
      runnerEntryPath: "/private-runner", newLaunchId: h.identity,
      seatLaunchEnvironment: { command: h.command } as unknown as SeatLaunchEnvironment });
    const preview = await adapter.previewLaunch(previewBinding({ model: "" }), opts);
    h.untouched(); assertRedacted(preview);
    expect(preview.commandTemplate!.includes("<seat-launch-environment>")).toBe(adapter.runtime === "pi");
    expect(preview.commandTemplate!.includes("--runtime omp --approval-mode always-ask")).toBe(adapter.runtime === "omp");
    expect(preview.commandTemplate).not.toMatch(/--model|API_KEY/);
  });
});
