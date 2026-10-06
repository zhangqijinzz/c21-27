import { simulateProject } from "./simulation";
import type {
  ScenarioSnapshot,
  SimulationMode,
  SimulationResult,
  TimelineEntry,
} from "./types";

export type OverlayPresence = "both" | "baseline-only" | "comparison-only";

export type CriticalMembership =
  "both" | "baseline-only" | "comparison-only" | "none";

export interface OverlaySide {
  entry: TimelineEntry;
  critical: boolean;
}

export interface OverlayTimingDelta {
  startMs: number;
  durationMs: number;
  endMs: number;
  waitMs: number;
}

export interface OverlayRow {
  nodeId: string;
  name: string;
  presence: OverlayPresence;
  baseline?: OverlaySide;
  comparison?: OverlaySide;
  /** 对照相对基准的变化（comparison - baseline），仅在两方案共有节点时存在 */
  delta?: OverlayTimingDelta;
}

export interface CriticalChip {
  nodeId: string;
  name: string;
  membership: CriticalMembership;
}

export interface OverlayTimeline {
  rows: OverlayRow[];
  maxMs: number;
  baselineCompletionMs: number;
  comparisonCompletionMs: number;
  baselineCritical: string[];
  comparisonCritical: string[];
  criticalChips: CriticalChip[];
  /** 关键链路的节点集合是否完全一致（顺序也一致） */
  criticalPathChanged: boolean;
  /** 重放推演失败（例如历史快照数据不完整） */
  invalid: boolean;
}

function snapshotProject(snapshot: ScenarioSnapshot) {
  return {
    id: `snapshot-${snapshot.id}`,
    title: snapshot.name,
    nodes: snapshot.nodes,
    concurrencyLimit: snapshot.concurrencyLimit,
    scenarios: [],
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.createdAt,
  };
}

/**
 * 用保存快照时的波动假设重放推演。历史快照没有记录模式，回落到预期情境。
 */
export function replaySnapshot(
  snapshot: ScenarioSnapshot,
  fallbackMode: SimulationMode = "expected",
): SimulationResult {
  const mode = snapshot.mode ?? fallbackMode;
  return simulateProject(snapshotProject(snapshot), mode);
}

/**
 * 最长公共子序列：以节点 id 对齐两份方案的拓扑顺序。
 * id 相同的节点落在同一行；仅在一侧出现的节点独占一行并保持各自的相对位置，
 * 因此新增/删除节点只会插入空行，不会让后续共有节点错位。
 */
export function alignNodeIds(
  baseline: string[],
  comparison: string[],
): {
  baseline: (string | null)[];
  comparison: (string | null)[];
} {
  const lengths = Array.from({ length: baseline.length + 1 }, () =>
    new Array<number>(comparison.length + 1).fill(0),
  );
  for (let i = baseline.length - 1; i >= 0; i -= 1)
    for (let j = comparison.length - 1; j >= 0; j -= 1)
      lengths[i]![j] =
        baseline[i] === comparison[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);

  const alignedBaseline: (string | null)[] = [];
  const alignedComparison: (string | null)[] = [];
  let i = 0;
  let j = 0;
  while (i < baseline.length && j < comparison.length) {
    if (baseline[i] === comparison[j]) {
      alignedBaseline.push(baseline[i]!);
      alignedComparison.push(comparison[j]!);
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      alignedBaseline.push(baseline[i]!);
      alignedComparison.push(null);
      i += 1;
    } else {
      alignedBaseline.push(null);
      alignedComparison.push(comparison[j]!);
      j += 1;
    }
  }
  while (i < baseline.length) {
    alignedBaseline.push(baseline[i]!);
    alignedComparison.push(null);
    i += 1;
  }
  while (j < comparison.length) {
    alignedBaseline.push(null);
    alignedComparison.push(comparison[j]!);
    j += 1;
  }
  return { baseline: alignedBaseline, comparison: alignedComparison };
}

function buildCriticalChips(
  baselinePath: string[],
  comparisonPath: string[],
  nameOf: (id: string) => string,
): CriticalChip[] {
  const baselineSet = new Set(baselinePath);
  const comparisonSet = new Set(comparisonPath);
  const chips: CriticalChip[] = [];
  const seen = new Set<string>();
  for (const id of [...baselinePath, ...comparisonPath]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const inBaseline = baselineSet.has(id);
    const inComparison = comparisonSet.has(id);
    chips.push({
      nodeId: id,
      name: nameOf(id),
      membership: inBaseline
        ? inComparison
          ? "both"
          : "baseline-only"
        : "comparison-only",
    });
  }
  return chips;
}

/**
 * 将基准与对照快照各自重放为时序推演，再按节点 id 稳定对齐为叠加视图模型。
 * 纯函数：选择变化时由调用方（useMemo）即时重建，视图立即跟随。
 */
export function buildOverlayTimeline(
  baseline: ScenarioSnapshot,
  comparison: ScenarioSnapshot,
  fallbackMode: SimulationMode = "expected",
): OverlayTimeline {
  const baselineResult = replaySnapshot(baseline, fallbackMode);
  const comparisonResult = replaySnapshot(comparison, fallbackMode);
  const invalid =
    baselineResult.entries.length !== baseline.nodes.length ||
    comparisonResult.entries.length !== comparison.nodes.length;

  const baselineEntries = new Map(
    baselineResult.entries.map((entry) => [entry.nodeId, entry]),
  );
  const comparisonEntries = new Map(
    comparisonResult.entries.map((entry) => [entry.nodeId, entry]),
  );
  const nameOf = (id: string): string =>
    comparison.nodes.find((node) => node.id === id)?.name ??
    baseline.nodes.find((node) => node.id === id)?.name ??
    id;
  const baselineCritical = new Set(baselineResult.criticalPath);
  const comparisonCritical = new Set(comparisonResult.criticalPath);

  const aligned = alignNodeIds(
    baselineResult.entries.map((entry) => entry.nodeId),
    comparisonResult.entries.map((entry) => entry.nodeId),
  );

  const rows: OverlayRow[] = aligned.baseline.map((baselineId, index) => {
    const comparisonId = aligned.comparison[index] ?? null;
    const id = baselineId ?? comparisonId;
    if (!id) throw new Error("aligned timeline row must reference a node");
    const baseEntry = baselineId ? baselineEntries.get(baselineId) : undefined;
    const compareEntry = comparisonId
      ? comparisonEntries.get(comparisonId)
      : undefined;
    const presence: OverlayPresence =
      baseEntry && compareEntry
        ? "both"
        : baseEntry
          ? "baseline-only"
          : "comparison-only";
    const row: OverlayRow = {
      nodeId: id,
      name: nameOf(id),
      presence,
      ...(baseEntry
        ? {
            baseline: {
              entry: baseEntry,
              critical: baselineCritical.has(baseEntry.nodeId),
            },
          }
        : {}),
      ...(compareEntry
        ? {
            comparison: {
              entry: compareEntry,
              critical: comparisonCritical.has(compareEntry.nodeId),
            },
          }
        : {}),
    };
    if (baseEntry && compareEntry)
      row.delta = {
        startMs: compareEntry.startMs - baseEntry.startMs,
        durationMs:
          compareEntry.modeledDurationMs - baseEntry.modeledDurationMs,
        endMs: compareEntry.endMs - baseEntry.endMs,
        waitMs: compareEntry.waitMs - baseEntry.waitMs,
      };
    return row;
  });

  const criticalPathChanged =
    baselineResult.criticalPath.join("→") !==
    comparisonResult.criticalPath.join("→");

  return {
    rows,
    maxMs: Math.max(
      1,
      baselineResult.completionMs,
      comparisonResult.completionMs,
    ),
    baselineCompletionMs: baselineResult.completionMs,
    comparisonCompletionMs: comparisonResult.completionMs,
    baselineCritical: baselineResult.criticalPath,
    comparisonCritical: comparisonResult.criticalPath,
    criticalChips: buildCriticalChips(
      baselineResult.criticalPath,
      comparisonResult.criticalPath,
      nameOf,
    ),
    criticalPathChanged,
    invalid,
  };
}
