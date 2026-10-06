import { simulateProject } from "../../shared/domain/simulation";
import type {
  LatencyProject,
  RequestNode,
  ScenarioSnapshot,
  SimulationResult,
  TimelineEntry,
} from "../../shared/domain/types";

export interface ScenarioComparison {
  deltaMs: number;
  changes: string[];
  outcome: "faster" | "slower" | "equal";
}

export type ScenarioSide = "baseline" | "comparison";

export interface ScenarioTimelineLane {
  entry?: TimelineEntry;
  node?: RequestNode;
  critical: boolean;
}

export interface ScenarioTimelineRow {
  id: string;
  name: string;
  baseline: ScenarioTimelineLane;
  comparison: ScenarioTimelineLane;
  status: "shared" | "removed" | "added";
  criticalStatus: "shared" | "baseline-only" | "comparison-only" | "none";
  startDeltaMs?: number;
  durationDeltaMs?: number;
  waitDeltaMs?: number;
  endDeltaMs?: number;
}

export interface ScenarioTimelineModel {
  rows: ScenarioTimelineRow[];
  maxMs: number;
  baselineResult: SimulationResult;
  comparisonResult: SimulationResult;
  criticalLinks: {
    side: ScenarioSide;
    from: string;
    to: string;
  }[];
}

export function simulateScenario(scenario: ScenarioSnapshot): SimulationResult {
  return simulateProject(
    {
      id: `scenario-${scenario.id}`,
      title: scenario.name,
      nodes: scenario.nodes,
      concurrencyLimit: scenario.concurrencyLimit,
      scenarios: [],
      createdAt: scenario.createdAt,
      updatedAt: scenario.createdAt,
    },
    scenario.mode ?? "expected",
  );
}

function criticalLinksFromResult(result: SimulationResult, side: ScenarioSide) {
  return result.criticalPath.slice(1).map((to, index) => ({
    side,
    from: result.criticalPath[index] ?? to,
    to,
  }));
}

export function buildScenarioTimeline(
  baseline: ScenarioSnapshot,
  comparison: ScenarioSnapshot,
): ScenarioTimelineModel {
  const baselineResult = simulateScenario(baseline);
  const comparisonResult = simulateScenario(comparison);
  const baselineNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
  const comparisonNodes = new Map(
    comparison.nodes.map((node) => [node.id, node]),
  );
  const baselineEntries = new Map(
    baselineResult.entries.map((entry) => [entry.nodeId, entry]),
  );
  const comparisonEntries = new Map(
    comparisonResult.entries.map((entry) => [entry.nodeId, entry]),
  );
  const baselineCritical = new Set(baseline.criticalPath);
  const comparisonCritical = new Set(comparison.criticalPath);
  const baselineOrder = new Map(
    baseline.nodes.map((node, index) => [node.id, index]),
  );
  const comparisonOrder = new Map(
    comparison.nodes.map((node, index) => [node.id, index]),
  );
  const rows = [
    ...new Set([...baselineNodes.keys(), ...comparisonNodes.keys()]),
  ]
    .map((id): ScenarioTimelineRow => {
      const baselineNode = baselineNodes.get(id);
      const comparisonNode = comparisonNodes.get(id);
      const baselineEntry = baselineEntries.get(id);
      const comparisonEntry = comparisonEntries.get(id);
      const isBaselineCritical = baselineCritical.has(id);
      const isComparisonCritical = comparisonCritical.has(id);
      return {
        id,
        name: comparisonNode?.name ?? baselineNode?.name ?? id,
        baseline: {
          entry: baselineEntry,
          node: baselineNode,
          critical: isBaselineCritical,
        },
        comparison: {
          entry: comparisonEntry,
          node: comparisonNode,
          critical: isComparisonCritical,
        },
        status:
          baselineNode && comparisonNode
            ? "shared"
            : baselineNode
              ? "removed"
              : "added",
        criticalStatus: isBaselineCritical
          ? isComparisonCritical
            ? "shared"
            : "baseline-only"
          : isComparisonCritical
            ? "comparison-only"
            : "none",
        ...(baselineEntry && comparisonEntry
          ? {
              startDeltaMs: comparisonEntry.startMs - baselineEntry.startMs,
              durationDeltaMs:
                comparisonEntry.modeledDurationMs -
                baselineEntry.modeledDurationMs,
              waitDeltaMs: comparisonEntry.waitMs - baselineEntry.waitMs,
              endDeltaMs: comparisonEntry.endMs - baselineEntry.endMs,
            }
          : {}),
      };
    })
    .sort((left, right) => {
      const leftBaseline = baselineOrder.get(left.id);
      const rightBaseline = baselineOrder.get(right.id);
      const leftComparison = comparisonOrder.get(left.id);
      const rightComparison = comparisonOrder.get(right.id);
      const leftOrder =
        leftBaseline ?? (leftComparison ?? 0) + baseline.nodes.length + 0.001;
      const rightOrder =
        rightBaseline ?? (rightComparison ?? 0) + baseline.nodes.length + 0.001;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return (leftComparison ?? 0) - (rightComparison ?? 0);
    });
  return {
    rows,
    maxMs: Math.max(
      1,
      baselineResult.completionMs,
      comparisonResult.completionMs,
    ),
    baselineResult,
    comparisonResult,
    criticalLinks: [
      ...criticalLinksFromResult(baselineResult, "baseline"),
      ...criticalLinksFromResult(comparisonResult, "comparison"),
    ],
  };
}

function describeNodeChanges(
  before: RequestNode,
  after: RequestNode,
): string[] {
  const changes: string[] = [];
  if (before.durationMs !== after.durationMs)
    changes.push(
      `${before.name} · 耗时 ${before.durationMs} → ${after.durationMs} ms`,
    );
  if (before.jitterMs !== after.jitterMs)
    changes.push(
      `${before.name} · 波动 ±${before.jitterMs} → ±${after.jitterMs} ms`,
    );
  if (before.timeoutMs !== after.timeoutMs)
    changes.push(
      `${before.name} · 超时 ${before.timeoutMs} → ${after.timeoutMs} ms`,
    );
  if (before.retryCount !== after.retryCount)
    changes.push(
      `${before.name} · 重试 ${before.retryCount} → ${after.retryCount} 次`,
    );
  if (before.failureRate !== after.failureRate)
    changes.push(
      `${before.name} · 失败率 ${before.failureRate} → ${after.failureRate}%`,
    );
  if (before.fallbackNodeId !== after.fallbackNodeId)
    changes.push(`${before.name} · 降级目标已调整`);
  if (before.dependencyIds.join("|") !== after.dependencyIds.join("|"))
    changes.push(`${before.name} · 前置依赖已调整`);
  return changes;
}

export function compareScenarios(
  baseline: ScenarioSnapshot,
  comparison: ScenarioSnapshot,
): ScenarioComparison {
  const baselineNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
  const comparisonNodes = new Map(
    comparison.nodes.map((node) => [node.id, node]),
  );
  const changes = [
    ...baseline.nodes.flatMap((node) => {
      const next = comparisonNodes.get(node.id);
      return next
        ? describeNodeChanges(node, next)
        : [`${node.name} · 已从对照方案移除`];
    }),
    ...comparison.nodes
      .filter((node) => !baselineNodes.has(node.id))
      .map((node) => `${node.name} · 新增请求节点`),
  ];
  if (baseline.concurrencyLimit !== comparison.concurrencyLimit)
    changes.unshift(
      `并发上限 · ${baseline.concurrencyLimit ?? "不限"} → ${comparison.concurrencyLimit ?? "不限"}`,
    );
  return {
    deltaMs: comparison.completionMs - baseline.completionMs,
    changes,
    outcome:
      comparison.completionMs < baseline.completionMs
        ? "faster"
        : comparison.completionMs > baseline.completionMs
          ? "slower"
          : "equal",
  };
}

export function saveScenario(
  project: LatencyProject,
  result: SimulationResult,
  name: string,
): LatencyProject {
  if (
    result.warnings.some(
      (warning) => warning.includes("检测到循环") || warning.includes("不能"),
    )
  )
    return project;
  const snapshot: ScenarioSnapshot = {
    id: crypto.randomUUID(),
    name: name.trim() || `方案 ${project.scenarios.length + 1}`,
    createdAt: Date.now(),
    mode: result.mode,
    concurrencyLimit: project.concurrencyLimit,
    nodes: structuredClone(project.nodes),
    completionMs: result.completionMs,
    criticalPath: [...result.criticalPath],
  };
  return {
    ...project,
    scenarios: [snapshot, ...project.scenarios],
    updatedAt: Date.now(),
  };
}

export function removeScenario(
  project: LatencyProject,
  scenarioId: string,
): LatencyProject {
  return {
    ...project,
    scenarios: project.scenarios.filter(
      (scenario) => scenario.id !== scenarioId,
    ),
    updatedAt: Date.now(),
  };
}

export function restoreScenario(
  project: LatencyProject,
  scenarioId: string,
): LatencyProject {
  const snapshot = project.scenarios.find(
    (scenario) => scenario.id === scenarioId,
  );
  if (!snapshot) return project;
  return {
    ...project,
    nodes: structuredClone(snapshot.nodes),
    concurrencyLimit: snapshot.concurrencyLimit,
    updatedAt: Date.now(),
  };
}
