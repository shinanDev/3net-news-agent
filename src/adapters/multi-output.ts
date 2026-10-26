import type { Output, RunReport } from "../ports/output.ts";

/** Renders the same report to several outputs (OUTPUT=html,newsletter), in order. */
export class MultiOutput implements Output {
  constructor(readonly outputs: Output[]) {}
  async render(report: RunReport): Promise<void> {
    for (const o of this.outputs) await o.render(report);
  }
}
