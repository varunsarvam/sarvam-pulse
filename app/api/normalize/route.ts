import { NextRequest, NextResponse } from "next/server";
import { chatComplete } from "@/lib/sarvam";

interface NormalizeResult {
  cluster: string;
  is_new: boolean;
  sentiment: number;
  confidence: number;
}

const FALLBACK: NormalizeResult = {
  cluster: "uncategorized",
  is_new: true,
  sentiment: 0,
  confidence: 0,
};

export async function POST(req: NextRequest) {
  try {
    const { answer_text, question_intent, existing_clusters } =
      await req.json();

    if (!answer_text) {
      return NextResponse.json(
        { error: "answer_text is required." },
        { status: 400 }
      );
    }

    const clusterSummary =
      Array.isArray(existing_clusters) && existing_clusters.length > 0
        ? JSON.stringify(existing_clusters.map((c: { label: string; count: number }) => ({ label: c.label, count: c.count })))
        : "none yet";

    const systemPrompt = [
      `Classify the answer below into one of the existing clusters,`,
      `OR propose a new cluster label (1-3 words, lowercase, hyphenated like 'cautiously-curious') if none fit.`,
      `Also output a sentiment score from -1 (negative) to 1 (positive).`,
      `Output strict JSON only, no preamble or markdown:`,
      `{"cluster": "label", "is_new": boolean, "sentiment": number, "confidence": number}`,
    ].join(" ");

    const userMessage = [
      `Question intent: ${question_intent ?? "not specified"}`,
      `Existing clusters: ${clusterSummary}`,
      `Answer: ${answer_text}`,
    ].join("\n");

    const result = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { model: "sarvam-105b", temperature: 0.3, max_tokens: 100 }
    );

    const raw = result.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip markdown code fences if the model wraps its output
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    try {
      const parsed = JSON.parse(cleaned) as Partial<NormalizeResult>;

      const normalized: NormalizeResult = {
        cluster:
          typeof parsed.cluster === "string" && parsed.cluster.trim()
            ? parsed.cluster.trim().toLowerCase().replace(/\s+/g, "-")
            : FALLBACK.cluster,
        is_new: typeof parsed.is_new === "boolean" ? parsed.is_new : true,
        sentiment:
          typeof parsed.sentiment === "number"
            ? Math.max(-1, Math.min(1, parsed.sentiment))
            : 0,
        confidence:
          typeof parsed.confidence === "number"
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0,
      };

      return NextResponse.json(normalized);
    } catch {
      console.warn("[normalize] JSON parse failed, raw output:", raw);
      return NextResponse.json(FALLBACK);
    }
  } catch (e) {
    console.error("[normalize] error:", e);
    return NextResponse.json(FALLBACK);
  }
}
