import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { bootstrapCommand } from "../src/commands/bootstrap.js";
import { requirementsCommand } from "../src/commands/requirements.js";
import { DaemonClient } from "../src/client.js";
import { STATE_FILE } from "../src/daemon-lifecycle.js";
import type { StatusDeps } from "../src/commands/status.js";

describe("bootstrap source paths belong to the caller", () => {
  let root: string;
  let callerDir: string;
  let daemonDir: string;
  let server: http.Server;
  let deps: StatusDeps;
  let priorExitCode: typeof process.exitCode;
  let catalog: Array<Record<string, string>>;
  let requests: Array<{ url: string; sourceRef: string; content: string }>;
  let catalogReads: number;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap source paths-"));
    callerDir = path.join(root, "caller project");
    daemonDir = path.join(root, "daemon project");
    for (const directory of [callerDir, daemonDir]) {
      fs.mkdirSync(path.join(directory, "nested folder"), { recursive: true });
      for (const file of ["rig.yaml", "nested folder/team spec.yml", "unlisted"]) {
        fs.writeFileSync(path.join(directory, file), `name: ${directory === callerDir ? "caller" : "daemon"}\n`);
      }
    }
    catalog = [{ id: "catalog-id", name: "catalog-rig", kind: "rig", sourcePath: path.join(daemonDir, "rig.yaml") }];
    requests = [];
    catalogReads = 0;
    // The responder reads relative paths from a different root, like an already-running daemon.
    server = http.createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/specs/library") {
        catalogReads++;
        res.end(JSON.stringify(catalog));
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const { sourceRef } = JSON.parse(raw) as { sourceRef: string };
      const content = fs.readFileSync(path.resolve(daemonDir, sourceRef), "utf8");
      requests.push({ url: req.url!, sourceRef, content });
      res.end(JSON.stringify({ status: req.url!.endsWith("plan") ? "planned" : "completed", stages: [], errors: [], warnings: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    deps = {
      lifecycleDeps: {
        spawn: vi.fn(), fetch: vi.fn(async () => ({ ok: true })), kill: vi.fn(),
        readFile: (p) => p === STATE_FILE ? JSON.stringify({ pid: 1, port, db: "test.sqlite", startedAt: "2026-10-13T00:00:00Z" }) : null,
        writeFile: vi.fn(), removeFile: vi.fn(), exists: (p) => p === STATE_FILE,
        mkdirp: vi.fn(), openForAppend: vi.fn(() => 3), isProcessAlive: vi.fn(() => true),
      },
      clientFactory: (url) => new DaemonClient(url),
    };
    priorExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(process, "cwd").mockReturnValue(callerDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = priorExitCode;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function run(command: string, source: string, args: string[] = []): Promise<void> {
    const program = new Command().exitOverride();
    program.addCommand(command === "bootstrap" ? bootstrapCommand(deps) : requirementsCommand(deps));
    await program.parseAsync(["node", "rig", command, source, ...args]);
  }

  const modes = [
    { command: "bootstrap", args: ["--plan"], route: "/api/bootstrap/plan" },
    { command: "bootstrap", args: ["--yes"], route: "/api/bootstrap/apply" },
    { command: "requirements", args: [], route: "/api/bootstrap/plan" },
  ];
  for (const mode of modes) {
    it.each(["rig.yaml", "./rig.yaml", "nested folder/team spec.yml"])
      (`${mode.command} ${mode.args.join(" ")} resolves %s before HTTP`, async (source) => {
        await run(mode.command, source, mode.args);
        expect(requests).toEqual([{ url: mode.route, sourceRef: path.join(callerDir, source), content: "name: caller\n" }]);
        expect(catalogReads).toBe(0);
        expect(process.exitCode).toBeUndefined();
      });

    it(`${mode.command} ${mode.args.join(" ")} preserves an absolute source`, async () => {
      const source = path.join(daemonDir, "nested folder/team spec.yml");
      await run(mode.command, source, mode.args);
      expect(requests).toEqual([{ url: mode.route, sourceRef: source, content: "name: daemon\n" }]);
      expect(catalogReads).toBe(0);
    });
  }

  it.each([false, true])("preserves catalog source paths (plan=%s)", async (plan) => {
    await run("bootstrap", "catalog-rig", [plan ? "--plan" : "--yes"]);
    expect(catalogReads).toBe(1);
    expect(requests[0]?.sourceRef).toBe(catalog[0]!.sourcePath);
    expect(requests[0]?.content).toBe("name: daemon\n");
  });

  it("preserves unresolved bare-name fallback", async () => {
    await run("bootstrap", "unlisted", ["--plan"]);
    expect(catalogReads).toBe(1);
    expect(requests[0]?.sourceRef).toBe("unlisted");
  });

  it("does not rebase a daemon-supplied catalog source", async () => {
    catalog[0]!.sourcePath = "rig.yaml";
    await run("bootstrap", "catalog-rig", ["--plan"]);
    expect(requests[0]?.sourceRef).toBe("rig.yaml");
    expect(requests[0]?.content).toBe("name: daemon\n");
  });

  it("still refuses ambiguous catalog names before posting", async () => {
    catalog.push({ ...catalog[0]!, id: "other-id", sourcePath: path.join(callerDir, "rig.yaml") });
    await run("bootstrap", "catalog-rig", ["--plan"]);
    expect(catalogReads).toBe(1);
    expect(requests).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});
