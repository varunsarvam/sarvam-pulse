/**
 * Pulse Seed Script — generates ~80 realistic responses for the hero form.
 *
 * USAGE:
 *   1. Make sure your .env.local has SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL
 *   2. Create the hero form via the creator UI first, copy its formId
 *   3. Run: npx tsx scripts/seed.ts <formId>
 *
 * The script writes directly to the database using the service role key,
 * bypassing the API routes for speed. It mimics the same shape as real submissions.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load env from .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf-8");
  envFile.split("\n").forEach((line) => {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) {
      process.env[key.trim()] = rest.join("=").trim();
    }
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============================================================================
// PERSONA DEFINITIONS
// Each persona has weighted preferences across the 6 questions.
// We'll generate sessions distributed across these archetypes.
// ============================================================================

type Persona = {
  name: string;
  weight: number; // relative likelihood
  q1_voice_responses: string[];
  q2_choice: "Help me create" | "Help me decide";
  q2_choice_alt_pct?: number; // % chance of picking the other option
  q3_slider_range: [number, number]; // 0-100
  q4_card_weights: Record<string, number>;
  q5_ranking_priorities: string[]; // top to bottom = most to least worried
  q5_jitter: number; // 0-1, how much randomness in ranking
  q6_text_responses: string[];
};

const personas: Persona[] = [
  {
    name: "Cautious Adopter",
    weight: 22,
    q1_voice_responses: [
      "Honestly, a mix. It's useful, but I'm always a little careful with it. I keep wondering what I'm trading off.",
      "Mostly cautious optimism, I guess. I use it daily but I wouldn't say I trust it.",
      "I feel like I'm watching something happen faster than I can really process. It's not bad, but it's a lot.",
      "Useful, but slightly uncomfortable. Like a really smart stranger I keep talking to.",
      "Curious, mostly. But there's a quiet voice in my head that says go slow.",
    ],
    q2_choice: "Help me decide",
    q2_choice_alt_pct: 30,
    q3_slider_range: [25, 50],
    q4_card_weights: {
      "A research partner — I think out loud with it": 0.35,
      "A shortcut machine — I want speed, not conversation": 0.45,
      "A creative collaborator — we build things together": 0.1,
      "I mostly avoid it — it's not for me yet": 0.1,
    },
    q5_ranking_priorities: [
      "Privacy and surveillance",
      "AI making decisions about me without my knowing",
      "People stop thinking for themselves",
      "Losing my job or skills",
      "It's getting smarter than us, faster than we're ready",
    ],
    q5_jitter: 0.2,
    q6_text_responses: [
      "Probably more integrated than I'm comfortable admitting. I'll have made my peace with it.",
      "Closer than today. I'll use it more, but I'll have figured out where to draw lines.",
      "Honestly hard to say — I think I'll lean on it a lot but stay a little wary.",
      "More entangled. Hopefully I'll still recognise myself in five years.",
    ],
  },
  {
    name: "Builder Believer",
    weight: 18,
    q1_voice_responses: [
      "Excited, mostly. I'm building with it every day and it feels like the most generative period I've had in years.",
      "Energised. It's the first tool that actually thinks with me. I'm leaning all the way in.",
      "Honestly, joy. I make more things now. I have more conversations with my own ideas.",
      "Like I'm in early internet again. There's so much possibility right now.",
      "Curious and creatively alive. It unlocks me.",
    ],
    q2_choice: "Help me create",
    q2_choice_alt_pct: 5,
    q3_slider_range: [55, 85],
    q4_card_weights: {
      "A research partner — I think out loud with it": 0.3,
      "A shortcut machine — I want speed, not conversation": 0.05,
      "A creative collaborator — we build things together": 0.6,
      "I mostly avoid it — it's not for me yet": 0.05,
    },
    q5_ranking_priorities: [
      "It's getting smarter than us, faster than we're ready",
      "AI making decisions about me without my knowing",
      "People stop thinking for themselves",
      "Privacy and surveillance",
      "Losing my job or skills",
    ],
    q5_jitter: 0.25,
    q6_text_responses: [
      "A creative partnership. I'll be making things I can't even imagine right now.",
      "Like a co-founder I trust. We'll build a lot together.",
      "Closer than ever — and I'm okay with that. It amplifies who I already am.",
      "Symbiotic, in the best sense. I'll be a better version of me because of it.",
    ],
  },
  {
    name: "Quiet Resistor",
    weight: 12,
    q1_voice_responses: [
      "Tired, honestly. It's everywhere and I didn't ask for it. I miss when things felt human.",
      "Suspicious. Most of what I read about it sounds like marketing or doom. Neither feels honest.",
      "Detached. I don't really use it. I'm not against it, just not pulled in.",
      "A kind of dread, if I'm being honest. I worry we're handing too much over.",
      "Disappointed in how the world is rushing toward this without thinking.",
    ],
    q2_choice: "Help me decide",
    q2_choice_alt_pct: 35,
    q3_slider_range: [0, 25],
    q4_card_weights: {
      "A research partner — I think out loud with it": 0.1,
      "A shortcut machine — I want speed, not conversation": 0.15,
      "A creative collaborator — we build things together": 0.05,
      "I mostly avoid it — it's not for me yet": 0.7,
    },
    q5_ranking_priorities: [
      "People stop thinking for themselves",
      "It's getting smarter than us, faster than we're ready",
      "Losing my job or skills",
      "AI making decisions about me without my knowing",
      "Privacy and surveillance",
    ],
    q5_jitter: 0.15,
    q6_text_responses: [
      "Limited, if I have any say in it. I want to keep my own thinking, my own voice.",
      "Distant, I hope. I'd like to still know what it feels like to figure things out alone.",
      "Probably forced into more contact than I want, sadly.",
      "Tense. I'll be using it but resenting it a little.",
    ],
  },
  {
    name: "Pragmatic User",
    weight: 18,
    q1_voice_responses: [
      "Practical. It saves me time. That's it, really. I don't have strong feelings about it.",
      "It's a tool. I treat it like one. Some days great, some days frustrating.",
      "Useful when it works. I don't romanticise it and I don't catastrophise it.",
      "Mostly neutral. I just want my work done faster.",
      "Honestly, a little bored of the conversation. Just let me use it and move on.",
    ],
    q2_choice: "Help me decide",
    q2_choice_alt_pct: 25,
    q3_slider_range: [15, 45],
    q4_card_weights: {
      "A research partner — I think out loud with it": 0.15,
      "A shortcut machine — I want speed, not conversation": 0.65,
      "A creative collaborator — we build things together": 0.1,
      "I mostly avoid it — it's not for me yet": 0.1,
    },
    q5_ranking_priorities: [
      "Privacy and surveillance",
      "Losing my job or skills",
      "AI making decisions about me without my knowing",
      "People stop thinking for themselves",
      "It's getting smarter than us, faster than we're ready",
    ],
    q5_jitter: 0.3,
    q6_text_responses: [
      "Routine. It'll be like email — I won't even think about it.",
      "More embedded but less novel. Just part of how things work.",
      "Functional. We'll have figured out the boundaries by then.",
      "Boring, in a good way. Just useful background infrastructure.",
    ],
  },
  {
    name: "Curious Skeptic",
    weight: 15,
    q1_voice_responses: [
      "Fascinated and a bit unsettled at the same time. Both feelings are real, neither cancels the other.",
      "I keep going back and forth. There are days I love it and days I want to put it away.",
      "Curious. Genuinely. But also alert in a way I can't quite put words to.",
      "It's the most interesting thing happening right now, and the most worrying. Both things at once.",
      "Honestly conflicted. I use it constantly but I'm not sure I should.",
    ],
    q2_choice: "Help me create",
    q2_choice_alt_pct: 40,
    q3_slider_range: [35, 65],
    q4_card_weights: {
      "A research partner — I think out loud with it": 0.55,
      "A shortcut machine — I want speed, not conversation": 0.15,
      "A creative collaborator — we build things together": 0.25,
      "I mostly avoid it — it's not for me yet": 0.05,
    },
    q5_ranking_priorities: [
      "People stop thinking for themselves",
      "It's getting smarter than us, faster than we're ready",
      "AI making decisions about me without my knowing",
      "Privacy and surveillance",
      "Losing my job or skills",
    ],
    q5_jitter: 0.2,
    q6_text_responses: [
      "Complicated. I'll still be questioning it, and that questioning will matter.",
      "Closer than today, but I hope I'll still be asking why a lot.",
      "Negotiated. Constantly. I don't think the conversation ever fully settles.",
      "Honestly uncertain. It depends so much on choices the rest of us make in the next few years.",
    ],
  },
  {
    name: "Hopeful Realist",
    weight: 15,
    q1_voice_responses: [
      "Cautiously hopeful. It's not all good and it's not all bad. We get to decide which parts win.",
      "Mixed but mostly hopeful. There's a lot to be careful about but also a lot to be excited about.",
      "Like we're at a turning point. I want to believe we'll get this right.",
      "Honestly, more hope than fear. But neither without the other.",
      "Open. I think it'll be a real force for good if we're thoughtful, and a mess if we're not.",
    ],
    q2_choice: "Help me create",
    q2_choice_alt_pct: 45,
    q3_slider_range: [40, 70],
    q4_card_weights: {
      "A research partner — I think out loud with it": 0.4,
      "A shortcut machine — I want speed, not conversation": 0.2,
      "A creative collaborator — we build things together": 0.35,
      "I mostly avoid it — it's not for me yet": 0.05,
    },
    q5_ranking_priorities: [
      "AI making decisions about me without my knowing",
      "People stop thinking for themselves",
      "Privacy and surveillance",
      "It's getting smarter than us, faster than we're ready",
      "Losing my job or skills",
    ],
    q5_jitter: 0.3,
    q6_text_responses: [
      "Closer, but on better terms than today. I think we'll have figured out some of the hard parts.",
      "More partnership than tool. With clear lines we've agreed on.",
      "Honestly, I'm hopeful. Different from now in ways I can't quite picture.",
      "Steadier. The early-days noise will settle and we'll be living with it like anything else.",
    ],
  },
];

// ============================================================================
// SAMPLING UTILITIES
// ============================================================================

function pickPersona(): Persona {
  const total = personas.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of personas) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return personas[0];
}

function pickFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[0][0];
}

function jitterArray<T>(arr: T[], jitter: number): T[] {
  // Each adjacent pair has `jitter` probability of swapping
  const result = [...arr];
  for (let i = 0; i < result.length - 1; i++) {
    if (Math.random() < jitter) {
      [result[i], result[i + 1]] = [result[i + 1], result[i]];
    }
  }
  return result;
}

function sliderValueFromRange([min, max]: [number, number]): number {
  // Slight bell curve toward the middle of the range
  const r = (Math.random() + Math.random()) / 2;
  return Math.round(min + r * (max - min));
}

// ============================================================================
// CLUSTER ASSIGNMENT
// For voice/text answers, we hand-label clusters. The real LLM normalize
// would do this online, but for seeding we encode persona → cluster mapping.
// ============================================================================

const personaClusterMap: Record<string, string> = {
  "Cautious Adopter": "cautiously-curious",
  "Builder Believer": "builder-believer",
  "Quiet Resistor": "resistant",
  "Pragmatic User": "pragmatic",
  "Curious Skeptic": "curious-skeptic",
  "Hopeful Realist": "hopeful-realist",
};

const personaSentimentRange: Record<string, [number, number]> = {
  "Cautious Adopter": [-0.1, 0.3],
  "Builder Believer": [0.5, 0.9],
  "Quiet Resistor": [-0.7, -0.2],
  "Pragmatic User": [-0.1, 0.2],
  "Curious Skeptic": [-0.2, 0.3],
  "Hopeful Realist": [0.3, 0.7],
};

function sentimentFor(persona: Persona): number {
  const [min, max] = personaSentimentRange[persona.name];
  return parseFloat((min + Math.random() * (max - min)).toFixed(2));
}

// ============================================================================
// MAIN SEEDER
// ============================================================================

async function seed(formId: string, count: number = 80) {
  // Fetch the questions for this form
  const { data: questions, error: qErr } = await supabase
    .from("questions")
    .select("*")
    .eq("form_id", formId)
    .order("position");

  if (qErr || !questions) {
    console.error("Failed to fetch questions:", qErr);
    return;
  }
  if (questions.length !== 6) {
    console.warn(
      `Expected 6 questions, found ${questions.length}. Continuing anyway.`
    );
  }

  console.log(`Seeding ${count} sessions for form ${formId}...`);

  // Spread session start times across the past 24 hours so the live count looks natural
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const persona = pickPersona();
    const startedAt = new Date(now - Math.random() * oneDayMs).toISOString();
    const completedAt = new Date(
      new Date(startedAt).getTime() + (90 + Math.random() * 180) * 1000
    ).toISOString();

    // Create session
    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .insert({
        form_id: formId,
        started_at: startedAt,
        completed_at: completedAt,
        identity_label: persona.name,
        identity_summary: `${persona.name} — seeded persona for hero demo.`,
      })
      .select()
      .single();

    if (sErr || !session) {
      console.error(`Session ${i} failed:`, sErr);
      continue;
    }

    const sessionId = session.id;

    // Generate answers per question
    for (const q of questions) {
      let raw_value: any;
      let transcript: string | null = null;
      let normalized: any = null;
      const sentiment = sentimentFor(persona);

      switch (q.input_type) {
        case "voice": {
          const text = pickFromArray(persona.q1_voice_responses);
          raw_value = { type: "voice", value: text };
          transcript = text;
          normalized = {
            cluster: personaClusterMap[persona.name],
            is_new: false,
            confidence: 0.8 + Math.random() * 0.15,
          };
          break;
        }
        case "text": {
          const text = pickFromArray(persona.q6_text_responses);
          raw_value = { type: "text", value: text };
          transcript = text;
          normalized = {
            cluster: personaClusterMap[persona.name],
            is_new: false,
            confidence: 0.8 + Math.random() * 0.15,
          };
          break;
        }
        case "this_or_that": {
          const flip =
            Math.random() * 100 < (persona.q2_choice_alt_pct ?? 0);
          const choice = flip
            ? persona.q2_choice === "Help me create"
              ? "Help me decide"
              : "Help me create"
            : persona.q2_choice;
          raw_value = { type: "this_or_that", value: choice };
          break;
        }
        case "emoji_slider": {
          const v = sliderValueFromRange(persona.q3_slider_range);
          raw_value = { type: "emoji_slider", value: v };
          break;
        }
        case "cards": {
          const choice = weightedPick(persona.q4_card_weights);
          raw_value = { type: "cards", value: choice };
          break;
        }
        case "ranking": {
          const ranked = jitterArray(
            persona.q5_ranking_priorities,
            persona.q5_jitter
          );
          raw_value = { type: "ranking", value: ranked };
          break;
        }
        default: {
          raw_value = { type: q.input_type, value: null };
        }
      }

      // Stagger answer timestamps within the session window
      const sessionStart = new Date(startedAt).getTime();
      const answeredAt = new Date(
        sessionStart + (q.position + 1) * 25_000 + Math.random() * 10_000
      ).toISOString();

      const { error: aErr } = await supabase.from("answers").insert({
        session_id: sessionId,
        question_id: q.id,
        raw_value,
        transcript,
        normalized,
        sentiment,
        created_at: answeredAt,
      });

      if (aErr) {
        console.error(`Answer for q${q.position} failed:`, aErr);
      }
    }

    // Optionally insert a reaction or two per session
    if (Math.random() < 0.6) {
      const reactionTypes = ["fire", "eyes", "hundred", "thinking"];
      const numReactions = 1 + Math.floor(Math.random() * 2);
      for (let r = 0; r < numReactions; r++) {
        const randomQ = questions[Math.floor(Math.random() * questions.length)];
        await supabase.from("reactions").insert({
          session_id: sessionId,
          question_id: randomQ.id,
          reaction: pickFromArray(reactionTypes),
        });
      }
    }

    if ((i + 1) % 10 === 0) {
      console.log(`  ...${i + 1} / ${count} sessions seeded`);
    }
  }

  // Now compute and write the aggregations table for each question
  console.log("Computing aggregations...");

  for (const q of questions) {
    const { data: answers } = await supabase
      .from("answers")
      .select("*")
      .eq("question_id", q.id);

    if (!answers || answers.length === 0) continue;

    const distribution: Record<string, number> = {};
    const clusters: Array<{ label: string; count: number; examples: string[] }> = [];
    const recent_quotes: string[] = [];
    let sentiment_sum = 0;
    let sentiment_count = 0;

    for (const a of answers) {
      const rv = a.raw_value as { type: string; value: any };

      if (q.input_type === "this_or_that" || q.input_type === "cards") {
        distribution[rv.value] = (distribution[rv.value] || 0) + 1;
      } else if (q.input_type === "emoji_slider") {
        const bucket =
          rv.value < 20
            ? "0-20"
            : rv.value < 40
            ? "20-40"
            : rv.value < 60
            ? "40-60"
            : rv.value < 80
            ? "60-80"
            : "80-100";
        distribution[bucket] = (distribution[bucket] || 0) + 1;
      } else if (q.input_type === "ranking") {
        // Average position per option (1-indexed, lower = higher priority)
        (rv.value as string[]).forEach((opt, idx) => {
          if (!distribution[opt]) distribution[opt] = 0;
          distribution[opt] += idx + 1;
        });
      } else if (
        (q.input_type === "voice" || q.input_type === "text") &&
        a.normalized
      ) {
        const label = (a.normalized as any).cluster;
        let cluster = clusters.find((c) => c.label === label);
        if (!cluster) {
          cluster = { label, count: 0, examples: [] };
          clusters.push(cluster);
        }
        cluster.count++;
        if (cluster.examples.length < 3 && a.transcript) {
          cluster.examples.push(a.transcript.slice(0, 120));
        }
      }

      if (a.sentiment != null) {
        sentiment_sum += a.sentiment;
        sentiment_count++;
      }

      if (a.transcript && recent_quotes.length < 10) {
        recent_quotes.push(a.transcript.slice(0, 80));
      }
    }

    // For ranking, convert sums to averages
    if (q.input_type === "ranking") {
      for (const k of Object.keys(distribution)) {
        distribution[k] = parseFloat(
          (distribution[k] / answers.length).toFixed(2)
        );
      }
    }

    await supabase.from("aggregations").upsert({
      question_id: q.id,
      total_responses: answers.length,
      distribution,
      sentiment_avg:
        sentiment_count > 0
          ? parseFloat((sentiment_sum / sentiment_count).toFixed(3))
          : 0,
      recent_quotes,
      clusters,
      updated_at: new Date().toISOString(),
    });
  }

  console.log("✓ Seeding complete.");
  console.log(`  Sessions: ${count}`);
  console.log(`  Questions aggregated: ${questions.length}`);
}

// ============================================================================
// ENTRY POINT
// ============================================================================

const formId = process.argv[2];
const count = parseInt(process.argv[3] || "80", 10);

if (!formId) {
  console.error("Usage: npx tsx scripts/seed.ts <formId> [count=80]");
  process.exit(1);
}

seed(formId, count)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
