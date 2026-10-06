import { describe, expect, it } from "vitest";
import {
  createProject,
  duplicateProject,
  selectProject,
} from "../src/features/projects/projectViewModel";
import {
  buildScenarioTimeline,
  compareScenarios,
  restoreScenario,
  saveScenario,
} from "../src/features/scenarios/scenarioViewModel";
import { simulateProject } from "../src/shared/domain/simulation";
import { EXAMPLE_PROJECT } from "../src/shared/domain/types";

describe("project and scenario view models", () => {
  it("creates a project and switches the active project", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const created = createProject(initial, 100);
    expect(created.projects).toHaveLength(2);
    expect(created.activeProjectId).not.toBe(EXAMPLE_PROJECT.id);
    expect(selectProject(created, EXAMPLE_PROJECT.id).activeProjectId).toBe(
      EXAMPLE_PROJECT.id,
    );
  });

  it("duplicates a project and remaps its dependency identities", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const duplicated = duplicateProject(initial, EXAMPLE_PROJECT, 10);
    const copy = duplicated.projects[0];
    expect(copy?.nodes[2]?.dependencyIds).toEqual([copy?.nodes[0]?.id]);
    expect(copy?.nodes[4]?.fallbackNodeId).toBe(copy?.nodes[3]?.id);
    expect(copy?.id).not.toBe(EXAMPLE_PROJECT.id);
    expect(copy?.scenarios).toEqual([]);
  });

  it("saves a complete snapshot and restores its parameters", () => {
    const baseline = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };
    const result = simulateProject(baseline);
    const saved = saveScenario(baseline, result, "并发方案");
    expect(saved.scenarios).toHaveLength(1);
    const changed = {
      ...saved,
      nodes: saved.nodes.map((node) => ({ ...node, durationMs: 999 })),
    };
    const restored = restoreScenario(changed, saved.scenarios[0]?.id ?? "");
    expect(restored.nodes[0]?.durationMs).toBe(baseline.nodes[0]?.durationMs);
  });

  it("describes node and concurrency differences between snapshots", () => {
    const baseline = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };
    const baselineSnapshot = saveScenario(
      baseline,
      simulateProject(baseline),
      "不限并发",
    ).scenarios[0];
    const changed = {
      ...baseline,
      concurrencyLimit: 1,
      nodes: baseline.nodes.map((node, index) =>
        index === 0 ? { ...node, durationMs: 900 } : node,
      ),
    };
    const changedSnapshot = saveScenario(
      changed,
      simulateProject(changed),
      "串行优化",
    ).scenarios[0];
    if (!baselineSnapshot || !changedSnapshot)
      throw new Error("Scenario fixtures should be saved");
    const comparison = compareScenarios(baselineSnapshot, changedSnapshot);
    expect(comparison.deltaMs).toBeGreaterThan(0);
    expect(comparison.changes.join(" ")).toContain("并发上限");
    expect(comparison.changes.join(" ")).toContain("耗时");
  });

  it("keeps changed nodes on stable rows when building an overlay timeline", () => {
    const node = (
      id: string,
      name: string,
      durationMs: number,
      dependencyIds: string[] = [],
    ) => ({
      id,
      name,
      durationMs,
      jitterMs: 0,
      dependencyIds,
      timeoutMs: 500,
      retryCount: 0,
      failureRate: 0,
    });
    const baselineProject = {
      ...EXAMPLE_PROJECT,
      concurrencyLimit: null,
      nodes: [
        node("a", "入口", 100),
        node("b", "串行中间层", 100, ["a"]),
        node("c", "结果", 100, ["b"]),
      ],
    };
    const comparisonProject = {
      ...baselineProject,
      nodes: [
        node("a", "入口", 100),
        node("c", "结果", 100, ["a"]),
        node("d", "旁路缓存", 50, ["a"]),
      ],
    };
    const baseline = saveScenario(
      baselineProject,
      simulateProject(baselineProject),
      "基准",
    ).scenarios[0];
    const comparison = saveScenario(
      comparisonProject,
      simulateProject(comparisonProject),
      "对照",
    ).scenarios[0];
    if (!baseline || !comparison) throw new Error("Snapshots should be saved");
    const timeline = buildScenarioTimeline(baseline, comparison);
    expect(timeline.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(timeline.rows.map((row) => row.status)).toEqual([
      "shared",
      "removed",
      "shared",
      "added",
    ]);
    const result = timeline.rows.find((row) => row.id === "c");
    expect(result?.startDeltaMs).toBe(-100);
    expect(result?.waitDeltaMs).toBe(0);
    expect(timeline.baselineResult.criticalPath).toEqual(["a", "b", "c"]);
    expect(timeline.comparisonResult.criticalPath).toEqual(["a", "c"]);
    expect(timeline.criticalLinks).toContainEqual({
      side: "comparison",
      from: "a",
      to: "c",
    });
  });

  it("preserves the selected simulation mode in snapshots", () => {
    const snapshot = saveScenario(
      EXAMPLE_PROJECT,
      simulateProject(EXAMPLE_PROJECT, "low"),
      "乐观快照",
    ).scenarios[0];
    expect(snapshot?.mode).toBe("low");
  });
});
