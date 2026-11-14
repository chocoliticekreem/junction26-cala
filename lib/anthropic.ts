// Server-only Haiku helper. Never import from a client component: it reads ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";

export const HAIKU = "claude-haiku-4-5";

let client: Anthropic | null | undefined;

export function getAnthropic(): Anthropic | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  client = apiKey ? new Anthropic({ apiKey, maxRetries: 2 }) : null;
  return client;
}

export type ToolDef = { name: string; description: string; input_schema: object };

// Forces one tool call and returns its input, or null on any failure (caller falls back).
export async function haikuTool(opts: {
  system: string;
  user: string;
  tool: ToolDef;
  maxTokens: number;
  strict?: boolean;
  timeoutMs?: number;
}): Promise<unknown | null> {
  const c = getAnthropic();
  if (!c) return null;
  const res = await c.messages.create(
    {
      model: HAIKU,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      tools: [
        {
          name: opts.tool.name,
          description: opts.tool.description,
          input_schema: opts.tool.input_schema as Anthropic.Tool.InputSchema,
          ...(opts.strict ? { strict: true } : {}),
        },
      ],
      tool_choice: { type: "tool", name: opts.tool.name },
    },
    { timeout: opts.timeoutMs ?? 30_000 },
  );
  const block = res.content.find((b) => b.type === "tool_use");
  return block && block.type === "tool_use" ? block.input : null;
}
