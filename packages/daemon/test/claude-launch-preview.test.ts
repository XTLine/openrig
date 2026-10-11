import { assertRedacted, previewBinding, previewHarness, templateCore } from "./helpers/runtime-preview.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shellQuote } from "../src/adapters/shell-quote.js";
import { operationalLaunchArgs } from "../src/adapters/kernel-authority.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code-adapter.js";
import type { NodeBinding } from "../src/domain/runtime-adapter.js";
import type { ClaudeManagedLaunch } from "../src/domain/claude-managed-launch.js";
import type { SeatLaunchEnvironment } from "../src/domain/seat-launch-environment.js";

const opts = Object.freeze({ name: "private-seat" });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Claude fresh launch preview", () => {
  it.each<Partial<NodeBinding>>([
    { launchPosture: "floor" }, { launchPosture: "full_bypass" }, { launchPosture: "auto" },
    { teamPermissionDefault: true }, { kernelAuthority: true },
    { launchPosture: "full_bypass", nonInterruptive: true },
  ])("matches the captured launch with placeholders: %j", async choice => {
    vi.stubEnv("OPENRIG_CLAUDE_DISABLE_ALTERNATE_SCREEN", "0");
    const h = previewHarness();
    const adapter = new ClaudeCodeAdapter({ tmux: h.tmux, fsOps: h.fs, sessionIdFactory: h.identity });
    const binding = previewBinding(choice);
    const preview = await adapter.previewLaunch(binding, opts);
    h.untouched();
    await adapter.launchHarness(binding, opts);
    const actual = h.sendText.mock.calls[0]![1] as string;
    const settings = operationalLaunchArgs("claude-code", binding)[1];
    const redacted = settings ? actual.replace(shellQuote(settings), shellQuote("<settings>")) : actual;
    expect(templateCore(preview)).toBe(redacted.replaceAll("private-model", "<model>")
      .replaceAll("private-effort", "<effort>").replaceAll("private-launch-id", "<session-id>")
      .replaceAll("private-seat", "<session-name>"));
    expect(preview.status).toBe(choice.launchPosture === "auto" ? "partial" : "available");
  });

  it("never prepares managed launch or the seat environment and redacts native mode/settings", async () => {
    vi.stubEnv("OPENRIG_AUTH_TOKEN", "private-auth-token");
    const h = previewHarness(), prepare = vi.fn();
    const adapter = new ClaudeCodeAdapter({ tmux: h.tmux, fsOps: h.fs, sessionIdFactory: h.identity,
      claudeManagedLaunch: { prepare } as unknown as ClaudeManagedLaunch,
      seatLaunchEnvironment: { command: h.command } as unknown as SeatLaunchEnvironment });
    const preview = await adapter.previewLaunch(previewBinding({ permissionMode: "PrivateMode", kernelAuthority: true }), opts);
    h.untouched(); expect(prepare).not.toHaveBeenCalled(); assertRedacted(preview);
    expect(preview.status).toBe("partial");
    expect(preview.commandTemplate).toContain("<managed-launch-environment> <claude-executable> '--permission-mode' '<permission-mode>' '--settings' '<settings>'");
    expect(preview.commandTemplate).not.toContain("PrivateMode");
    expect(preview.warnings.join(" ")).toContain("not probed");
  });

  it.each<Partial<NodeBinding>>([
    { permissionMode: "acceptEdits", kernelAuthority: true },
    { permissionMode: "bypassPermissions", launchPosture: "full_bypass", nonInterruptive: true },
  ])("shares managed fresh argv and redacts settings without capability preparation: %j", async choice => {
    const h = previewHarness();
    const command = vi.fn((args: readonly string[]) => "<managed-launch-environment> <claude-executable> " + args.map(shellQuote).join(" "));
    const prepare = vi.fn(async () => ({ command, assertCurrent: vi.fn() }));
    const adapter = new ClaudeCodeAdapter({ tmux: h.tmux, fsOps: h.fs, sessionIdFactory: h.identity,
      claudeManagedLaunch: { prepare } as unknown as ClaudeManagedLaunch });
    const binding = previewBinding(choice);
    const preview = await adapter.previewLaunch(binding, opts);
    h.untouched(); expect(prepare).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
    await adapter.launchHarness(binding, opts);
    const settings = operationalLaunchArgs("claude-code", binding)[1]!;
    expect(templateCore(preview)).toBe(h.sendShellCommand.mock.calls[0]![1]
      .replace(shellQuote(settings), shellQuote("<settings>")).replace(shellQuote(binding.permissionMode!), "'<permission-mode>'")
      .replaceAll("private-model", "<model>").replaceAll("private-effort", "<effort>")
      .replaceAll("private-launch-id", "<session-id>").replaceAll("private-seat", "<session-name>"));
  });

  it("shows environment wrappers without raw values and omits unset model/effort", async () => {
    const h = previewHarness();
    const adapter = new ClaudeCodeAdapter({ tmux: h.tmux, fsOps: h.fs,
      seatLaunchEnvironment: { command: h.command } as unknown as SeatLaunchEnvironment });
    const preview = await adapter.previewLaunch(previewBinding({ model: " ", effort: undefined }), opts);
    h.untouched(); assertRedacted(preview);
    expect(preview.commandTemplate).toContain("<seat-launch-environment>");
    expect(preview.commandTemplate).not.toMatch(/--model|--effort/);
  });
});
