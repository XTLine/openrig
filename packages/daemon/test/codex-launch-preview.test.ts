import { assertRedacted, previewBinding, previewHarness, templateCore } from "./helpers/runtime-preview.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexRuntimeAdapter } from "../src/adapters/codex-runtime-adapter.js";
import type { NodeBinding } from "../src/domain/runtime-adapter.js";
import type { SeatLaunchEnvironment } from "../src/domain/seat-launch-environment.js";

const opts = Object.freeze({ name: "private-seat@private-rig" });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Codex fresh launch preview", () => {
  it.each<Partial<NodeBinding>>([
    { launchPosture: "floor" }, { launchPosture: "full_bypass", nonInterruptive: true }, { kernelAuthority: true },
  ])("matches the captured command with unresolved git placeholders: %j", async choice => {
    vi.stubEnv("OPENRIG_SHARED_DOCS_ROOT", "/private-shared");
    const h = previewHarness(), resolveGitAddDirs = vi.fn(async () => ["/private-git"]);
    const adapter = new CodexRuntimeAdapter({ tmux: h.tmux, fsOps: h.fs, resolveGitAddDirs });
    const binding = previewBinding(choice);
    const preview = await adapter.previewLaunch(binding, opts);
    h.untouched(); expect(resolveGitAddDirs).not.toHaveBeenCalled();
    await adapter.launchHarness(binding, opts);
    const actual = h.sendShellCommand.mock.calls[0]![1];
    expect(templateCore(preview)).toBe(actual.replaceAll("/private-cwd", "<cwd>")
      .replace("--add-dir '/private-git'", "<git-metadata-options>")
      .replace("/private-shared/rigs/private-rig/state/private", "<queue-state-dir>")
      .replaceAll("private-model", "<model>").replaceAll("private-effort", "<effort>"));
  });

  it("never probes native support/config/profile, resolves git, or prepares workspaces/environment", async () => {
    vi.stubEnv("OPENRIG_AUTH_TOKEN", "private-auth-token");
    const h = previewHarness();
    const probes = { detectDaemonSupport: vi.fn(), verifyProfilePreflight: vi.fn(),
      readNetworkDefault: vi.fn(), resolveGitAddDirs: vi.fn(), prepareTeamWorkspace: vi.fn() };
    const adapter = new CodexRuntimeAdapter({ tmux: h.tmux, fsOps: h.fs, ...probes,
      codexHome: "/private-codex-home", launchPath: "/private-path",
      seatLaunchEnvironment: { command: h.command } as unknown as SeatLaunchEnvironment });
    const preview = await adapter.previewLaunch(previewBinding({ teamPermissionDefault: true }), opts);
    h.untouched(); for (const probe of Object.values(probes)) expect(probe).not.toHaveBeenCalled();
    assertRedacted(preview); expect(preview.status).toBe("partial");
    expect(preview.commandTemplate).toContain("<seat-launch-environment>");
    expect(preview.commandTemplate).toContain("<daemon-support-options>");
    expect(preview.commandTemplate).toContain("<network-default-options>");
    expect(preview.commandTemplate).toContain("<team-workspace-options>");
    expect(preview.commandTemplate).not.toContain("--no-daemon");
    expect(preview.warnings.join(" ")).toContain("unknown");
    const profile = await adapter.previewLaunch(previewBinding({ codexConfigProfile: "private-profile" }), opts);
    assertRedacted(profile); expect(profile.commandTemplate).toContain("-p '<profile>'");
    expect(profile.commandTemplate).not.toContain("<network-default-options>");
    expect(probes.verifyProfilePreflight).not.toHaveBeenCalled();
  });

  it("does not imply network overrides on bypass or queue directories for legacy names", async () => {
    const h = previewHarness();
    const adapter = new CodexRuntimeAdapter({ tmux: h.tmux, fsOps: h.fs, readNetworkDefault: vi.fn(),
      codexHome: "/private-home" });
    const preview = await adapter.previewLaunch(previewBinding({ launchPosture: "full_bypass", model: "", effort: "" }), { name: "r01-seat" });
    h.untouched(); assertRedacted(preview);
    expect(preview.commandTemplate).toContain("<launch-environment>");
    expect(preview.commandTemplate).not.toMatch(/<network-default-options>|<queue-state-dir>|<model>|<effort>/);
  });
});
