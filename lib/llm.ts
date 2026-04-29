import { chatComplete } from "./sarvam";

export interface NormalizeResult {
  cluster: string;
  is_new: boolean;
  confidence: number;
  sentiment: number;
}

/**
 * Classify a free-text answer into a thematic cluster and score sentiment.
 * Uses a single non-streaming LLM call (~400-600ms).
 */
export async function normalizeAnswer(
  text: string,
  questionIntent: string | null,
  existingClusters: string[]
): Promise<NormalizeResult> {
  console.time("normalize-total");
  console.time("normalize-prompt-build");
  const clusterList =
    existingClusters.length > 0 ? existingClusters.join(", ") : "(none yet)";

  const systemPrompt = `You classify survey responses into thematic clusters and assess sentiment.
Respond ONLY with a JSON object — no markdown fences, no explanation.
Schema: {"cluster":"<2-4 word label>","is_new":<bool>,"confidence":<0-1>,"sentiment":<-1 to 1>}
- If the response fits an existing cluster, reuse its EXACT label and set is_new=false.
- If no cluster fits, create a concise 2-4 word label and set is_new=true.
- sentiment: -1 = very negative, 0 = neutral, 1 = very positive.`;

  const userMessage = `Question intent: ${questionIntent ?? "general feedback"}
Existing clusters: ${clusterList}
Response to classify: "${text}"`;

  console.timeEnd("normalize-prompt-build");
  console.log(
    `[normalize] system_prompt_chars=${systemPrompt.length} estimated_tokens=${Math.ceil(systemPrompt.length / 4)}`
  );

  console.time("normalize-llm-complete");
  const result = await chatComplete(
    [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    {
      model: "sarvam-105b",
      temperature: 0.1,
      max_tokens: 120,
      top_p: 1,
      extra_body: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    }
  );
  console.timeEnd("normalize-llm-complete");

  const raw = result.choices[0]?.message?.content?.trim() ?? "";

  try {
    let jsonStr = raw;
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    else if (!jsonStr.startsWith("{")) {
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) jsonStr = objMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    const normalized = {
      cluster:
        typeof parsed.cluster === "string" ? parsed.cluster : "uncategorized",
      is_new: typeof parsed.is_new === "boolean" ? parsed.is_new : true,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5,
      sentiment:
        typeof parsed.sentiment === "number"
          ? Math.max(-1, Math.min(1, parsed.sentiment))
          : 0,
    };
    console.timeEnd("normalize-total");
    return normalized;
  } catch {
    console.timeEnd("normalize-total");
    return {
      cluster: "uncategorized",
      is_new: true,
      confidence: 0.3,
      sentiment: 0,
    };
  }
}
