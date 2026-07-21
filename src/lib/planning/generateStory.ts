import { CREATE_STORY_TOOL, storyContentFromTool } from "./storyTool";
import { shardStory, type ShardDeps, type StoryContent } from "../engine/shard";

/**
 * SM story generation (§ create-next-story): run the SM persona with the
 * create_story tool over the plan context, validate the result, and shard it to
 * a story file. The model call is injected (`callWithTool`) so the orchestration
 * is testable; the real call wraps the Anthropic SDK (UI phase).
 */
export interface GenerateStoryDeps extends ShardDeps {
  /** run the model with the tool; returns the tool's input (create_story args) */
  callWithTool: (
    systemPrompt: string,
    userPrompt: string,
    tool: typeof CREATE_STORY_TOOL
  ) => Promise<unknown>;
}

export interface GenerateStoryInput {
  /** the SM persona system prompt (composeSystemPrompt of the `sm` persona) */
  systemPrompt: string;
  /** the relevant epic/PRD + architecture the story derives from */
  planContext: string;
  epic: number;
  story: number;
}

export async function generateStory(
  deps: GenerateStoryDeps,
  input: GenerateStoryInput
): Promise<{ path: string; content: StoryContent }> {
  const userPrompt = [
    "Create the next story from the plan context below. Populate every field of",
    "the create_story tool with enough detail that the Dev agent needs nothing",
    "else — write the failing test first is expected.",
    "",
    "## Plan context",
    input.planContext,
  ].join("\n");

  const toolInput = await deps.callWithTool(
    input.systemPrompt,
    userPrompt,
    CREATE_STORY_TOOL
  );
  const content = storyContentFromTool(toolInput, input.epic, input.story);
  const { path } = await shardStory(deps, content);
  return { path, content };
}
