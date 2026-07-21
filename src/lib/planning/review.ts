import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "../../stores/usageStore";

/**
 * Adversarial review (§3.11): every artifact is critiqued by a same-discipline
 * reviewer with a default-to-reject posture. The reviewer emits a structured
 * verdict + findings so the Cockpit can show the review fleet at work.
 */

export const REPORT_FINDINGS_TOOL = {
  name: "report_findings" as const,
  description: "Report your adversarial review verdict and findings.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string" as const,
        enum: ["accept", "block"],
        description: "block if there is ANY material flaw; accept only if the artifact is genuinely sound",
      },
      summary: { type: "string" as const, description: "one-line overall assessment" },
      findings: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            severity: { type: "string" as const, enum: ["blocker", "major", "minor"] },
            title: { type: "string" as const, description: "short problem statement" },
            detail: { type: "string" as const, description: "what's wrong and what to change" },
          },
          required: ["severity", "title", "detail"],
        },
      },
    },
    required: ["verdict", "findings"],
  },
};

export type Severity = "blocker" | "major" | "minor";
export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
}
export interface ReviewResult {
  verdict: "accept" | "block";
  summary: string;
  findings: Finding[];
}

export async function reviewArtifact(opts: {
  apiKey: string;
  model: string;
  /** the adversarial same-role reviewer system prompt */
  systemPrompt: string;
  /** the document being reviewed */
  artifact: string;
  /** upstream context the reviewer should hold it against (e.g. the PRD) */
  context?: string;
}): Promise<ReviewResult> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const userPrompt = [
    opts.context ? `## Upstream context (hold the artifact against this)\n${opts.context}\n` : "",
    "## Artifact under review\n",
    opts.artifact,
    "\n\nReview this adversarially — try to BREAK it. Call report_findings with your verdict and every material flaw.",
  ].join("\n");

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 2048,
    system: opts.systemPrompt,
    tools: [REPORT_FINDINGS_TOOL as Anthropic.Tool],
    tool_choice: { type: "tool", name: "report_findings" },
    messages: [{ role: "user", content: userPrompt }],
  });
  recordUsage(response.usage, opts.model);

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "report_findings") {
      const input = block.input as {
        verdict?: string;
        summary?: string;
        findings?: unknown;
      };
      const findings: Finding[] = Array.isArray(input.findings)
        ? (input.findings as unknown[])
            .map((f) => f as Partial<Finding>)
            .filter((f): f is Finding => !!f && typeof f.title === "string" && typeof f.detail === "string")
            .map((f) => ({
              severity: (["blocker", "major", "minor"] as const).includes(f.severity as Severity)
                ? (f.severity as Severity)
                : "major",
              title: f.title,
              detail: f.detail,
            }))
        : [];
      return {
        verdict: input.verdict === "block" ? "block" : "accept",
        summary: typeof input.summary === "string" ? input.summary : "",
        findings,
      };
    }
  }
  throw new Error("reviewer did not report findings");
}
