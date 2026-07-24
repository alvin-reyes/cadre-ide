import type Anthropic from "@anthropic-ai/sdk";
import { errorMessage } from "../reportError";

/**
 * The 5 tool schemas exposed to the Orchestrator v2 controller.
 * NOTE: `approve_plan` is intentionally absent — the verification-freeze
 * trust gate stays human and is never delegated to the model.
 */
export const ORCHESTRATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: "shard_story",
    description:
      "Break the specified epic's approved PRD into user stories. Call this to generate the story list for an epic before dispatching work.",
    input_schema: {
      type: "object" as const,
      properties: {
        epic: {
          type: "integer" as const,
          description: "The 1-based epic index to shard. Defaults to 1.",
        },
      },
      required: [],
    },
  },
  {
    name: "shard_backlog",
    description:
      "Re-shard the full backlog for the specified epic, replacing any existing story list. Use when the PRD changes significantly.",
    input_schema: {
      type: "object" as const,
      properties: {
        epic: {
          type: "integer" as const,
          description: "The 1-based epic index whose backlog to shard. Defaults to 1.",
        },
      },
      required: [],
    },
  },
  {
    name: "approve_story",
    description:
      "Approve a specific story so it is eligible for dispatch. Both epic and story indices are required.",
    input_schema: {
      type: "object" as const,
      properties: {
        epic: {
          type: "integer" as const,
          description: "The 1-based epic index.",
        },
        story: {
          type: "integer" as const,
          description: "The 1-based story index within the epic.",
        },
      },
      required: ["epic", "story"],
    },
  },
  {
    name: "dispatch_story",
    description:
      "Dispatch a single approved story to the coding agent. Both epic and story indices are required.",
    input_schema: {
      type: "object" as const,
      properties: {
        epic: {
          type: "integer" as const,
          description: "The 1-based epic index.",
        },
        story: {
          type: "integer" as const,
          description: "The 1-based story index within the epic.",
        },
      },
      required: ["epic", "story"],
    },
  },
  {
    name: "dispatch_ready",
    description:
      "Dispatch all stories that are approved and ready to run. Takes no arguments.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

export interface OrchestratorActions {
  shardStory: (epic: number) => Promise<void>;
  shardBacklog: (epic: number) => Promise<void>;
  approveStory: (epic: number, story: number) => Promise<void>;
  dispatchStory: (epic: number, story: number) => Promise<void>;
  dispatchReady: () => Promise<void>;
}

export interface ToolOutcome {
  ok: boolean;
  message: string;
}

/**
 * Coerce a value to an integer. Returns `null` when the value is
 * undefined/null, non-numeric, or fractional — so callers can detect
 * missing vs. bad args uniformly.
 */
function asInt(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) return null;
  return n;
}

/**
 * Validate the tool name + args, run the mapped action, return an outcome.
 * NEVER throws: unknown tool / bad args → `{ok:false, message}`; an action
 * that throws is caught → `{ok:false, message: errorMessage(e)}`.
 */
export async function runOrchestratorTool(
  name: string,
  input: unknown,
  actions: OrchestratorActions
): Promise<ToolOutcome> {
  const args = (input ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "shard_story": {
        const epicRaw = args.epic !== undefined ? args.epic : 1;
        const epic = asInt(epicRaw);
        if (epic === null) return { ok: false, message: `shard_story: epic must be an integer, got ${String(epicRaw)}` };
        await actions.shardStory(epic);
        return { ok: true, message: `sharded story for epic ${epic}` };
      }

      case "shard_backlog": {
        const epicRaw = args.epic !== undefined ? args.epic : 1;
        const epic = asInt(epicRaw);
        if (epic === null) return { ok: false, message: `shard_backlog: epic must be an integer, got ${String(epicRaw)}` };
        await actions.shardBacklog(epic);
        return { ok: true, message: `sharded backlog for epic ${epic}` };
      }

      case "approve_story": {
        const epic = asInt(args.epic);
        const story = asInt(args.story);
        if (epic === null) return { ok: false, message: "approve_story: epic (integer) is required" };
        if (story === null) return { ok: false, message: "approve_story: story (integer) is required" };
        await actions.approveStory(epic, story);
        return { ok: true, message: `approved story ${epic}.${story}` };
      }

      case "dispatch_story": {
        const epic = asInt(args.epic);
        const story = asInt(args.story);
        if (epic === null) return { ok: false, message: "dispatch_story: epic (integer) is required" };
        if (story === null) return { ok: false, message: "dispatch_story: story (integer) is required" };
        await actions.dispatchStory(epic, story);
        return { ok: true, message: `dispatched story ${epic}.${story}` };
      }

      case "dispatch_ready": {
        await actions.dispatchReady();
        return { ok: true, message: "dispatched all ready stories" };
      }

      default:
        return { ok: false, message: `unknown orchestrator tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
