import { expect, vi } from "vitest";
import type { NodeBinding, RuntimeLaunchPreview } from "../../src/domain/runtime-adapter.js";
import type { TmuxAdapter } from "../../src/adapters/tmux.js";

const native = vi.hoisted(() => vi.fn(() => { throw new Error("Native execution is forbidden in previews"); }));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  execFile: native, execFileSync: native, spawn: native, spawnSync: native,
  exec: native, execSync: native, fork: native,
}));

export function previewHarness() {
  const fs = { readFile: vi.fn(() => "private-startup-content"), writeFile: vi.fn(), mkdirp: vi.fn(),
    copyFile: vi.fn(), exists: vi.fn(() => true), listFiles: vi.fn(() => []), homedir: "/private-home" };
  // Stop real launchHarness at its transport boundary, before readiness or provider execution.
  const sendText = vi.fn(async (_session: string, _command: string) => ({ ok: false as const, code: "test_stop", message: "captured only" }));
  const sendShellCommand = vi.fn(async (_session: string, _command: string) => ({ ok: false as const, code: "test_stop", message: "captured only" }));
  const sendKeys = vi.fn();
  const tmux = { sendText, sendShellCommand, sendKeys } as unknown as TmuxAdapter;
  const identity = vi.fn(() => "private-launch-id");
  const command = vi.fn(async () => { throw new Error("Launch environment must not be prepared"); });
  const untouched = () => {
    for (const fn of [native, ...Object.values(fs).filter(v => typeof v === "function"),
      sendText, sendShellCommand, sendKeys, identity, command]) expect(fn).not.toHaveBeenCalled();
  };
  return { fs, tmux, sendText, sendShellCommand, identity, command, untouched };
}

export function previewBinding(overrides: Partial<NodeBinding> = {}): NodeBinding {
  return Object.freeze({ id: "private-binding", nodeId: "private-node", tmuxSession: "rig-test-dev-seat",
    tmuxWindow: null, tmuxPane: null, cmuxWorkspace: null, cmuxSurface: null, updatedAt: "", cwd: "/private-cwd",
    model: "private-model", effort: "private-effort", launchPosture: "floor", ...overrides });
}

export function assertRedacted(preview: RuntimeLaunchPreview) {
  expect(preview.executable).toBe(false);
  if (preview.commandTemplate !== null) {
    expect(preview.commandTemplate).toMatch(/^# Preview only: [^\r\n]*$/);
    expect(preview.commandTemplate).toContain("<");
  }
  expect(JSON.stringify(preview)).not.toMatch(/private-|rig-test-dev-seat/);
}

export function templateCore(preview: RuntimeLaunchPreview): string {
  assertRedacted(preview);
  return preview.commandTemplate!.replace("# Preview only: ", "");
}
