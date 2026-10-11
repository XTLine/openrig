import type {
  RuntimeAdapter,
  InstalledResource,
  NodeBinding,
  ProjectionResult,
  StartupDeliveryResult,
  ReadinessResult,
  ResolvedStartupFile,
  HarnessLaunchResult,
  RuntimeLaunchPreview,
} from "../domain/runtime-adapter.js";
import type { ProjectionPlan } from "../domain/projection-planner.js";

/**
 * Terminal runtime adapter for infrastructure nodes.
 * All operations are no-ops — the shell is immediately interactive.
 * Startup actions (send_text) are handled by the startup orchestrator,
 * not by this adapter.
 */
export class TerminalAdapter implements RuntimeAdapter {
  readonly runtime = "terminal";

  async listInstalled(_binding: NodeBinding): Promise<InstalledResource[]> {
    return [];
  }

  async project(_plan: ProjectionPlan, _binding: NodeBinding): Promise<ProjectionResult> {
    return { projected: [], skipped: [], failed: [] };
  }

  async deliverStartup(_files: ResolvedStartupFile[], _binding: NodeBinding): Promise<StartupDeliveryResult> {
    return { delivered: 0, failed: [] };
  }

  /**
   * Report that terminal seats retain their shell and have no harness command.
   * A null template is intentional, not a failed probe; startup actions are separate
   * and are neither replayed nor inspected by this side-effect-free preview.
   */
  async previewLaunch(_binding: NodeBinding, _opts: { name: string }): Promise<RuntimeLaunchPreview> {
    return { status: "available", executable: false, commandTemplate: null,
      warnings: ["Terminal reuses its shell; there is no harness command. Startup actions are separate."] };
  }

  async launchHarness(
    _binding: NodeBinding,
    opts: { name: string; resumeToken?: string; forkSource?: import("../domain/runtime-adapter.js").ForkSource },
  ): Promise<HarnessLaunchResult> {
    if (opts.forkSource) {
      return {
        ok: false,
        error: "terminal runtime has no native fork primitive; remove session_source for terminal members",
      };
    }
    return { ok: true };
  }

  async checkReady(_binding: NodeBinding): Promise<ReadinessResult> {
    return { ready: true };
  }
}
