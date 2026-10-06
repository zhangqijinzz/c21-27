import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ComparisonTimeline from "../src/features/scenarios/ComparisonTimeline";
import { buildOverlayTimeline } from "../src/shared/domain/comparisonTimeline";
import { saveScenario } from "../src/features/scenarios/scenarioViewModel";
import { simulateProject } from "../src/shared/domain/simulation";
import type { LatencyProject, RequestNode } from "../src/shared/domain/types";

function node(
  id: string,
  durationMs: number,
  dependencyIds: string[] = [],
): RequestNode {
  return {
    id,
    name: `节点${id}`,
    durationMs,
    jitterMs: 0,
    dependencyIds,
    timeoutMs: 5000,
    retryCount: 0,
    failureRate: 0,
  };
}

function snapshotOf(nodes: RequestNode[], limit: number | null) {
  const project: LatencyProject = {
    id: "p",
    title: "t",
    nodes,
    concurrencyLimit: limit,
    scenarios: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return saveScenario(project, simulateProject(project), "s").scenarios[0]!;
}

describe("ComparisonTimeline", () => {
  it("renders aligned rows, finish markers and delta text for mismatched node sets", () => {
    const baseline = snapshotOf(
      [node("a", 300), node("b", 200), node("c", 100)],
      null,
    );
    const comparison = snapshotOf(
      [node("a", 150), node("b2", 250), node("c", 100)],
      1,
    );
    const overlay = buildOverlayTimeline(baseline, comparison);
    const html = renderToStaticMarkup(
      createElement(ComparisonTimeline, {
        overlay,
        baselineName: baseline.name,
        comparisonName: comparison.name,
      }),
    );
    // 三个共有/独有身份都各占一行
    expect(html).toContain("两方案共有");
    expect(html).toContain("对照方案已移除");
    expect(html).toContain("对照方案新增");
    // 两条完成时刻线都渲染
    expect(html).toContain("ct-finish-line-base");
    expect(html).toContain("ct-finish-line-comp");
    // 启动提前以负号呈现
    expect(html).toContain("−");
  });
});
