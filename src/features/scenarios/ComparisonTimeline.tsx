import { GitCompareArrows } from "lucide-react";
import type {
  CriticalMembership,
  OverlayRow,
  OverlayTimeline,
} from "../../shared/domain/comparisonTimeline";

interface Props {
  overlay: OverlayTimeline;
  baselineName: string;
  comparisonName: string;
}

const marks = [0, 0.25, 0.5, 0.75, 1];

function formatTime(value: number): string {
  if (Math.abs(value) < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function signed(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "持平";
  return `${rounded > 0 ? "+" : "−"}${formatTime(Math.abs(rounded))}`;
}

function deltaClass(value: number): string {
  if (Math.round(value) === 0) return "ct-delta-flat";
  return value < 0 ? "ct-delta-good" : "ct-delta-bad";
}

function chipClass(membership: CriticalMembership): string {
  if (membership === "both") return "ct-path-both";
  if (membership === "baseline-only") return "ct-path-base";
  if (membership === "comparison-only") return "ct-path-comp";
  return "";
}

function chipLabel(membership: CriticalMembership): string {
  if (membership === "baseline-only") return "仅基准";
  if (membership === "comparison-only") return "仅对照";
  return "共有";
}

function barTitle(
  side: "基准" | "对照",
  row: OverlayRow,
  entry: {
    startMs: number;
    endMs: number;
    modeledDurationMs: number;
    waitMs: number;
  },
  critical: boolean,
): string {
  return [
    `${side} · ${row.name}`,
    `启动 ${formatTime(entry.startMs)}`,
    `耗时 ${formatTime(entry.modeledDurationMs)}`,
    `完成 ${formatTime(entry.endMs)}`,
    `排队 ${formatTime(entry.waitMs)}`,
    critical ? "关键路径" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function ComparisonTimeline({
  overlay,
  baselineName,
  comparisonName,
}: Props) {
  if (overlay.invalid)
    return (
      <div className="ct-card">
        <div className="timeline-empty">
          历史快照缺少完整的链路数据，无法重放叠加时序。
        </div>
      </div>
    );

  const max = overlay.maxMs;
  const pct = (ms: number) => (ms / max) * 100;
  return (
    <div className="ct-card">
      <div className="ct-head">
        <div>
          <span className="section-label">叠加执行时序</span>
          <span className="timeline-caption">
            同一条请求上下叠放：空心为基准，实心为对照
          </span>
        </div>
        <div className="ct-legend">
          <span>
            <i className="ct-legend-base" /> 基准
          </span>
          <span>
            <i className="ct-legend-comp" /> 对照
          </span>
          <span>
            <i className="ct-legend-crit" /> 关键节点
          </span>
          <span>
            <i className="ct-legend-wait" /> 排队
          </span>
        </div>
      </div>

      <div className="ct-path-strip">
        <span className="ct-path-title">
          <GitCompareArrows size={12} /> 关键链路
        </span>
        {overlay.criticalPathChanged ? (
          <div className="ct-path-chips">
            {overlay.criticalChips.map((chip) => (
              <em key={chip.nodeId} className={chipClass(chip.membership)}>
                {chip.name}
                <small>{chipLabel(chip.membership)}</small>
              </em>
            ))}
          </div>
        ) : (
          <div className="ct-path-same">
            {overlay.criticalChips.map((chip, index) => (
              <span key={chip.nodeId}>
                {index > 0 && <b>→</b>}
                {chip.name}
              </span>
            ))}
            <small>两方案关键链路一致，差异来自耗时与排队</small>
          </div>
        )}
      </div>

      <div className="ct-scroll">
        <div className="ct-axis timeline-axis">
          <div className="axis-label">REQUEST</div>
          <div className="axis-track">
            {marks.map((mark) => (
              <span
                key={mark}
                style={{
                  left: `${mark * 100}%`,
                  transform:
                    mark === 0
                      ? "none"
                      : mark === 1
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                }}
              >
                {formatTime(max * mark)}
              </span>
            ))}
            <span
              className="ct-finish-label ct-finish-base"
              style={{
                left: `${pct(overlay.baselineCompletionMs)}%`,
                transform:
                  overlay.baselineCompletionMs >= max
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
              }}
            >
              基准完成 {formatTime(overlay.baselineCompletionMs)}
            </span>
            <span
              className="ct-finish-label ct-finish-comp"
              style={{
                left: `${pct(overlay.comparisonCompletionMs)}%`,
                transform:
                  overlay.comparisonCompletionMs >= max
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
              }}
            >
              对照完成 {formatTime(overlay.comparisonCompletionMs)}
            </span>
          </div>
          <div className="axis-end">START / Δ</div>
        </div>

        {overlay.rows.map((row) => {
          const base = row.baseline;
          const comp = row.comparison;
          return (
            <div
              className={`ct-row ct-presence-${row.presence}`}
              key={row.nodeId}
            >
              <div className="ct-name">
                <span
                  className={`ct-icon ${
                    row.presence === "baseline-only"
                      ? "ct-icon-gone"
                      : row.presence === "comparison-only"
                        ? "ct-icon-new"
                        : ""
                  }`}
                >
                  {row.name.slice(0, 1)}
                </span>
                <span>
                  <b>{row.name}</b>
                  <small>
                    {row.presence === "baseline-only"
                      ? "对照方案已移除"
                      : row.presence === "comparison-only"
                        ? "对照方案新增"
                        : "两方案共有"}
                  </small>
                </span>
              </div>

              <div className="ct-track">
                <div className="timeline-grid" />
                {base && base.entry.waitMs > 0 && (
                  <div
                    className="ct-wait ct-wait-base"
                    style={{
                      left: `${pct(base.entry.startMs - base.entry.waitMs)}%`,
                      width: `${pct(base.entry.waitMs)}%`,
                    }}
                  />
                )}
                {comp && comp.entry.waitMs > 0 && (
                  <div
                    className="ct-wait ct-wait-comp"
                    style={{
                      left: `${pct(comp.entry.startMs - comp.entry.waitMs)}%`,
                      width: `${pct(comp.entry.waitMs)}%`,
                    }}
                  />
                )}
                {base && (
                  <div
                    className={`ct-bar ct-bar-base ${
                      base.critical ? "is-critical" : ""
                    }`}
                    style={{
                      left: `${pct(base.entry.startMs)}%`,
                      width: `${Math.max(0.8, pct(base.entry.modeledDurationMs))}%`,
                    }}
                    title={barTitle("基准", row, base.entry, base.critical)}
                  />
                )}
                {comp && (
                  <div
                    className={`ct-bar ct-bar-comp ${
                      comp.critical ? "is-critical" : ""
                    }`}
                    style={{
                      left: `${pct(comp.entry.startMs)}%`,
                      width: `${Math.max(1, pct(comp.entry.modeledDurationMs))}%`,
                    }}
                    title={barTitle("对照", row, comp.entry, comp.critical)}
                  >
                    <span>{formatTime(comp.entry.modeledDurationMs)}</span>
                  </div>
                )}
                <span
                  className="ct-finish-line ct-finish-line-base"
                  style={{ left: `${pct(overlay.baselineCompletionMs)}%` }}
                />
                <span
                  className="ct-finish-line ct-finish-line-comp"
                  style={{ left: `${pct(overlay.comparisonCompletionMs)}%` }}
                />
              </div>

              <div className="ct-delta">
                {row.delta ? (
                  (
                    [
                      ["启动", row.delta.startMs],
                      ["耗时", row.delta.durationMs],
                      ["排队", row.delta.waitMs],
                    ] as const
                  ).map(([label, value]) => (
                    <span key={label} className={deltaClass(value)}>
                      {label} {signed(value)}
                    </span>
                  ))
                ) : (
                  <span className="ct-delta-flat">
                    {row.presence === "baseline-only" ? "—" : "新增节点"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="ct-foot">
        {baselineName} VS {comparisonName} · 时间轴按两方案最大完成时间统一刻度
      </div>
    </div>
  );
}
