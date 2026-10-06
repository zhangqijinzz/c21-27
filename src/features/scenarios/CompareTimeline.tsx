import { useMemo } from "react";
import type {
  ScenarioSnapshot,
  TimelineEntry,
} from "../../shared/domain/types";
import {
  buildScenarioTimeline,
  type ScenarioSide,
  type ScenarioTimelineLane,
  type ScenarioTimelineModel,
  type ScenarioTimelineRow,
} from "./scenarioViewModel";

interface Props {
  baseline: ScenarioSnapshot;
  comparison: ScenarioSnapshot;
}

const ROW_HEIGHT = 56;
const LANE_BASELINE_TOP = 8;
const LANE_COMPARISON_TOP = 30;
const LANE_HEIGHT = 12;

function formatTime(value: number): string {
  if (Math.abs(value) < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function signedTime(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value === 0) return "持平";
  return `${value > 0 ? "+" : "−"}${formatTime(Math.abs(value))}`;
}

function laneTitle(
  label: string,
  lane: ScenarioTimelineLane,
): string | undefined {
  const entry = lane.entry;
  if (!entry) return undefined;
  return [
    label,
    `开始 ${formatTime(entry.startMs)}`,
    `耗时 ${formatTime(entry.modeledDurationMs)}`,
    `排队 ${formatTime(entry.waitMs)}`,
    `结束 ${formatTime(entry.endMs)}`,
    lane.critical ? "关键路径" : "非关键路径",
  ].join(" · ");
}

function barStyle(entry: TimelineEntry, maxMs: number, top: number) {
  const left = Math.max(0, (entry.startMs / maxMs) * 100);
  const width = Math.max(0.8, (entry.modeledDurationMs / maxMs) * 100);
  return {
    left: `${left}%`,
    width: `${Math.min(width, 100 - left)}%`,
    top: `${top}px`,
  };
}

function waitStyle(entry: TimelineEntry, maxMs: number, top: number) {
  const left = Math.max(0, ((entry.startMs - entry.waitMs) / maxMs) * 100);
  const width = Math.max(0, (entry.waitMs / maxMs) * 100);
  return {
    left: `${left}%`,
    width: `${width}%`,
    top: `${top + 3}px`,
  };
}

function Lane({
  side,
  lane,
  maxMs,
}: {
  side: ScenarioSide;
  lane: ScenarioTimelineLane;
  maxMs: number;
}) {
  const entry = lane.entry;
  if (!entry) {
    return (
      <div className={`compare-lane compare-lane-empty is-${side}`}>
        无此节点
      </div>
    );
  }
  const top = side === "baseline" ? LANE_BASELINE_TOP : LANE_COMPARISON_TOP;
  return (
    <>
      {entry.waitMs > 0 && (
        <div
          className="compare-wait"
          style={waitStyle(entry, maxMs, top)}
          title={`${side === "baseline" ? "基准" : "对照"}排队 ${formatTime(entry.waitMs)}`}
        />
      )}
      <div
        className={`compare-bar is-${side} ${lane.critical ? "is-critical" : ""}`}
        style={barStyle(entry, maxMs, top)}
        title={laneTitle(side === "baseline" ? "基准方案" : "对照方案", lane)}
      />
    </>
  );
}

function CriticalPath({
  snapshot,
  model,
  side,
}: {
  snapshot: ScenarioSnapshot;
  model: ScenarioTimelineModel;
  side: ScenarioSide;
}) {
  const result =
    side === "baseline" ? model.baselineResult : model.comparisonResult;
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const otherPath = new Set(
    side === "baseline"
      ? model.comparisonResult.criticalPath
      : model.baselineResult.criticalPath,
  );
  return (
    <div className={`critical-path-line is-${side}`}>
      <span>{side === "baseline" ? "基准链路" : "对照链路"}</span>
      <div>
        {result.criticalPath.length ? (
          result.criticalPath.map((id, index) => (
            <em key={id} className={otherPath.has(id) ? "" : "is-changed"}>
              {index > 0 && <b>→</b>}
              {nodes.get(id)?.name ?? id}
            </em>
          ))
        ) : (
          <em className="is-empty">暂无可计算链路</em>
        )}
      </div>
    </div>
  );
}

export default function CompareTimeline({ baseline, comparison }: Props) {
  const model = useMemo(
    () => buildScenarioTimeline(baseline, comparison),
    [baseline, comparison],
  );
  const marks = [0, 0.25, 0.5, 0.75, 1];
  const baselineCriticalCount = model.rows.filter(
    (row) => row.baseline.critical,
  ).length;
  const comparisonCriticalCount = model.rows.filter(
    (row) => row.comparison.critical,
  ).length;

  const linkPath = (
    links: ScenarioTimelineModel["criticalLinks"],
    side: ScenarioSide,
  ) =>
    links
      .filter((link) => link.side === side)
      .map((link) => {
        const fromRow = model.rows.findIndex((row) => row.id === link.from);
        const toRow = model.rows.findIndex((row) => row.id === link.to);
        const from = model.rows[fromRow];
        const to = model.rows[toRow];
        const fromEntry =
          side === "baseline" ? from?.baseline.entry : from?.comparison.entry;
        const toEntry =
          side === "baseline" ? to?.baseline.entry : to?.comparison.entry;
        if (!from || !to || !fromEntry || !toEntry || fromRow < 0 || toRow < 0)
          return "";
        const x1 = (fromEntry.endMs / model.maxMs) * 1000;
        const x2 = (toEntry.startMs / model.maxMs) * 1000;
        const laneTop =
          side === "baseline" ? LANE_BASELINE_TOP : LANE_COMPARISON_TOP;
        const y1 = fromRow * ROW_HEIGHT + laneTop + LANE_HEIGHT / 2;
        const y2 = toRow * ROW_HEIGHT + laneTop + LANE_HEIGHT / 2;
        const bend = Math.max(12, Math.min(48, (y2 - y1) / 2));
        return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
      })
      .filter(Boolean)
      .join(" ");

  return (
    <div className="compare-timeline-card">
      <div className="compare-timeline-head">
        <div>
          <span className="section-label">叠加执行时序</span>
          <span className="timeline-caption">
            同一节点固定在同一行；上条为基准，下条为对照
          </span>
        </div>
        <div className="timeline-legend compare-legend">
          <span>
            <i className="legend-baseline" /> 基准
          </span>
          <span>
            <i className="legend-comparison" /> 对照
          </span>
          <span>
            <i className="legend-compare-critical" /> 关键路径
          </span>
          <span>
            <i className="legend-wait" /> 排队
          </span>
        </div>
      </div>

      <div className="compare-timeline-scroll">
        <div className="compare-timeline">
          <div className="compare-axis-row">
            <div className="compare-node-heading">REQUEST / CHANGE</div>
            <div className="compare-axis-track">
              {marks.map((mark) => (
                <span key={mark} style={{ left: `${mark * 100}%` }}>
                  {formatTime(model.maxMs * mark)}
                </span>
              ))}
            </div>
            <div className="compare-end-heading">END</div>
          </div>

          <div
            className="compare-rows"
            style={{ height: model.rows.length * ROW_HEIGHT }}
          >
            <svg
              className="critical-link-layer"
              viewBox={`0 0 1000 ${model.rows.length * ROW_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                className="critical-link baseline-link"
                d={linkPath(model.criticalLinks, "baseline")}
              />
              <path
                className="critical-link comparison-link"
                d={linkPath(model.criticalLinks, "comparison")}
              />
              <line
                className="completion-line baseline-line"
                x1={(baseline.completionMs / model.maxMs) * 1000}
                x2={(baseline.completionMs / model.maxMs) * 1000}
                y1="0"
                y2={model.rows.length * ROW_HEIGHT}
              />
              <line
                className="completion-line comparison-line"
                x1={(comparison.completionMs / model.maxMs) * 1000}
                x2={(comparison.completionMs / model.maxMs) * 1000}
                y1="0"
                y2={model.rows.length * ROW_HEIGHT}
              />
            </svg>
            {model.rows.map((row, index) => (
              <TimelineRow key={row.id} row={row} index={index} model={model} />
            ))}
          </div>
        </div>
      </div>

      <div className="critical-path-compare">
        <CriticalPath snapshot={baseline} model={model} side="baseline" />
        <CriticalPath snapshot={comparison} model={model} side="comparison" />
      </div>
      <div className="compare-timeline-note">
        新增或删除的节点保留独立行；悬停色块可查看开始、耗时、排队和结束时间。虚线/亮色连线为对应方案的关键依赖链。
        基准节点 {baselineCriticalCount} 个，对照关键节点{" "}
        {comparisonCriticalCount} 个。
      </div>
    </div>
  );
}

function TimelineRow({
  row,
  index,
  model,
}: {
  row: ScenarioTimelineRow;
  index: number;
  model: ScenarioTimelineModel;
}) {
  const statusLabel =
    row.status === "added"
      ? "新增"
      : row.status === "removed"
        ? "对照已删除"
        : row.criticalStatus === "baseline-only"
          ? "移出关键链"
          : row.criticalStatus === "comparison-only"
            ? "进入关键链"
            : row.criticalStatus === "shared"
              ? "关键链共有"
              : "普通节点";
  return (
    <div
      className={`compare-row status-${row.status} critical-${row.criticalStatus} ${
        index % 2 ? "is-alt" : ""
      }`}
      style={{ top: index * ROW_HEIGHT }}
    >
      <div className="compare-node-name">
        <span
          className={`compare-node-icon is-${row.status} tone-${index % 4}`}
        >
          {row.name.slice(0, 1)}
        </span>
        <span>
          <b title={row.name}>{row.name}</b>
          <small>
            <em>{statusLabel}</em>
            {row.status === "shared" && (
              <>
                开始 {signedTime(row.startDeltaMs)} · 排队{" "}
                {signedTime(row.waitDeltaMs)}
              </>
            )}
          </small>
        </span>
      </div>
      <div className="compare-track">
        <span className="compare-lane-label is-baseline">A</span>
        <span className="compare-lane-label is-comparison">B</span>
        <Lane side="baseline" lane={row.baseline} maxMs={model.maxMs} />
        <Lane side="comparison" lane={row.comparison} maxMs={model.maxMs} />
      </div>
      <div className="compare-end-times">
        <span className="is-baseline">
          {row.baseline.entry ? formatTime(row.baseline.entry.endMs) : "—"}
        </span>
        <span className="is-comparison">
          {row.comparison.entry ? formatTime(row.comparison.entry.endMs) : "—"}
        </span>
      </div>
    </div>
  );
}
