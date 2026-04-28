export type InputType =
  | "voice"
  | "text"
  | "emoji_slider"
  | "cards"
  | "ranking"
  | "this_or_that"
  | "visual_select";

export type FormTone = "playful" | "calm" | "direct" | "insightful";
export type FormStatus = "draft" | "published";

export interface Form {
  id: string;
  title: string;
  intent: string | null;
  tone: FormTone;
  status: FormStatus;
  created_at: string;
}

export interface Question {
  id: string;
  form_id: string;
  position: number;
  prompt: string;
  intent: string | null;
  input_type: InputType;
  options: unknown | null;
  follow_up_enabled: boolean;
  required: boolean;
}

export interface Session {
  id: string;
  form_id: string;
  started_at: string;
  completed_at: string | null;
  identity_label: string | null;
  identity_summary: string | null;
}

export interface Answer {
  id: string;
  session_id: string;
  question_id: string;
  raw_value: unknown;
  transcript: string | null;
  normalized: {
    cluster: string;
    is_new: boolean;
    confidence: number;
  } | null;
  sentiment: number | null;
  created_at: string;
}

export type ReactionType = "fire" | "eyes" | "hundred" | "thinking";

export interface Reaction {
  id: string;
  session_id: string;
  question_id: string;
  reaction: ReactionType;
  created_at: string;
}

export interface Cluster {
  label: string;
  count: number;
  examples: string[];
}

export interface Aggregation {
  question_id: string;
  total_responses: number;
  distribution: Record<string, number>;
  sentiment_avg: number;
  recent_quotes: string[];
  clusters: Cluster[];
  updated_at: string;
}
