import { describe, expect, it } from "vitest";
import {
  alignNodeIds,
  buildOverlayTimeline,
  replaySnapshot,
} from "../src/shared/domain/comparisonTimeline";
import { saveScenario } from "../src/features/scenarios/scenarioViewModel";
import { simulateProject } from "../src/shared/domain/simulation";
import type {
  LatencyProject,
  RequestNode,
  ScenarioSnapshot,
} from "../src/shared/domain/types";

function node(
  id: string,
  durationMs: number,
  dependencyIds: string[] = [],
  name = id,
): RequestNode {
  return {
    id,
    name,
    durationMs,
    jitterMs: 0,
    dependencyIds,
    timeoutMs: 5000,
    retryCount: 0,
    failureRate: 0,
  };
}

function project(nodes: RequestNode[], concurrencyLimit: number | null = null) {
  const value: LatencyProject = {
    id: "p",
    title: "t",
    nodes,
    concurrencyLimit,
    scenarios: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return value;
}

function snapshotOf(
  nodes: RequestNode[],
  concurrencyLimit: number | null = null,
  mode: "low" | "expected" | "high" = "expected",
): ScenarioSnapshot {
  const p = project(nodes, concurrencyLimit);
  const saved = saveScenario(p, simulateProject(p, mode), "s");
  return saved.scenarios[0]!;
}

describe("alignNodeIds", () => {
  it("keeps shared ids on the same row when a node is removed", () => {
    const aligned = alignNodeIds(["a", "b", "c", "d"], ["a", "c", "d"]);
    expect(aligned.baseline).toEqual(["a", "b", "c", "d"]);
    expect(aligned.comparison).toEqual(["a", null, "c", "d"]);
  });

  it("keeps shared ids aligned when a node is inserted", () => {
    const aligned = alignNodeIds(["a", "c"], ["a", "b", "c"]);
    expect(aligned.baseline).toEqual(["a", null, "c"]);
    expect(aligned.comparison).toEqual(["a", "b", "c"]);
  });

  it("uses node identity rather than list position", () => {
    // 顺序重排后，b/c 仍是两方案的最长公共子序列，必须成对对齐
    const aligned = alignNodeIds(["a", "b", "c"], ["b", "c", "a"]);
    const pairs = aligned.baseline.map((id, index) => [
      id,
      aligned.comparison[index],
    ]);
    expect(pairs).toContainEqual(["b", "b"]);
    expect(pairs).toContainEqual(["c", "c"]);
    expect(pairs).toContainEqual(["a", null]);
    expect(pairs).toContainEqual([null, "a"]);
    // 一行两侧绝不会错配为两个不同节点
    pairs.forEach(([id, other]) => {
      if (id && other) expect(id).toBe(other);
    });
  });
});

describe("replaySnapshot", () => {
  it("re-simulates with the mode stored on the snapshot", () => {
    const jittery = node("a", 100, [], "a");
    jittery.jitterMs = 100;
    const low = snapshotOf([jittery], null, "low");
    const high = snapshotOf([jittery], null, "high");
    expect(replaySnapshot(low).completionMs).toBe(100);
    expect(replaySnapshot(high).completionMs).toBe(200);
  });

  it("falls back to expected mode for legacy snapshots without a mode", () => {
    const legacy = { ...snapshotOf([node("a", 100)]), mode: undefined };
    expect(replaySnapshot(legacy).completionMs).toBe(100);
  });
});

describe("buildOverlayTimeline", () => {
  it("aligns shared nodes and exposes per-node timing deltas", () => {
    const baseline = snapshotOf([
      node("a", 300, [], "入口"),
      node("b", 200, ["a"], "下游"),
    ]);
    const comparisonNodes = [
      node("a", 200, [], "入口"),
      node("b", 200, ["a"], "下游"),
    ];
    const comparison = snapshotOf(comparisonNodes);
    const overlay = buildOverlayTimeline(baseline, comparison);
    expect(overlay.rows).toHaveLength(2);
    expect(overlay.rows.every((row) => row.presence === "both")).toBe(true);
    const a = overlay.rows.find((row) => row.nodeId === "a")!;
    expect(a.delta?.durationMs).toBe(-100);
    expect(a.delta?.startMs).toBe(0);
    const b = overlay.rows.find((row) => row.nodeId === "b")!;
    expect(b.delta?.startMs).toBe(-100);
    expect(b.baseline?.entry.startMs).toBe(300);
    expect(b.comparison?.entry.startMs).toBe(200);
  });

  it("marks added and removed nodes without shifting the shared rows", () => {
    const baseline = snapshotOf([
      node("a", 100),
      node("b", 100),
      node("c", 100),
    ]);
    const comparison = snapshotOf([
      node("a", 100),
      node("b2", 100),
      node("c", 100),
    ]);
    const overlay = buildOverlayTimeline(baseline, comparison);
    const byId = new Map(overlay.rows.map((row) => [row.nodeId, row]));
    expect(byId.get("a")?.presence).toBe("both");
    expect(byId.get("c")?.presence).toBe("both");
    expect(byId.get("b")?.presence).toBe("baseline-only");
    expect(byId.get("b")?.comparison).toBeUndefined();
    expect(byId.get("b2")?.presence).toBe("comparison-only");
    expect(byId.get("b2")?.baseline).toBeUndefined();
    // 共有节点始终与自身对齐，不与新增/删除节点撞行
    expect(
      overlay.rows.filter((row) => row.baseline && row.comparison),
    ).toHaveLength(2);
  });

  it("surfaces extra queueing introduced by a concurrency limit", () => {
    const nodes = [node("a", 100, [], "入口一"), node("b", 100, [], "入口二")];
    const unlimited = snapshotOf(nodes, null);
    const serialized = snapshotOf(nodes, 1);
    const overlay = buildOverlayTimeline(unlimited, serialized);
    const queued = overlay.rows.find((row) => row.delta?.waitMs === 100);
    expect(queued).toBeDefined();
    expect(overlay.comparisonCompletionMs - overlay.baselineCompletionMs).toBe(
      100,
    );
  });

  it("flags when the critical path switches to another chain", () => {
    const baseline = snapshotOf([
      node("a", 300, [], "快链"),
      node("b", 100, [], "慢链"),
    ]);
    const comparison = snapshotOf([
      node("a", 100, [], "快链"),
      node("b", 400, [], "慢链"),
    ]);
    const overlay = buildOverlayTimeline(baseline, comparison);
    expect(overlay.criticalPathChanged).toBe(true);
    const chipA = overlay.criticalChips.find((chip) => chip.nodeId === "a");
    const chipB = overlay.criticalChips.find((chip) => chip.nodeId === "b");
    expect(chipA?.membership).toBe("baseline-only");
    expect(chipB?.membership).toBe("comparison-only");
  });

  it("uses one shared time scale across both plans", () => {
    const baseline = snapshotOf([node("a", 200)]);
    const comparison = snapshotOf([node("a", 800)]);
    const overlay = buildOverlayTimeline(baseline, comparison);
    expect(overlay.maxMs).toBe(800);
    expect(overlay.baselineCompletionMs).toBe(200);
    expect(overlay.comparisonCompletionMs).toBe(800);
  });
});
