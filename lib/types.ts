export type InputType =
  | "voice"
  | "text"
  | "emoji_slider"
  | "cards"
  | "ranking"
  | "this_or_that"
  | "visual_select";

export interface Form {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  owner_id: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  form_id: string;
  order: number;
  input_type: InputType;
  prompt: string;
  options: Record<string, unknown> | null;
  required: boolean;
  created_at: string;
}

export interface Session {
  id: string;
  form_id: string;
  respondent_id: string | null;
  started_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface Answer {
  id: string;
  session_id: string;
  question_id: string;
  value: unknown;
  raw_transcript: string | null;
  created_at: string;
}

export interface Reaction {
  id: string;
  session_id: string;
  question_id: string;
  emoji: string;
  intensity: number | null;
  created_at: string;
}

export interface Aggregation {
  id: string;
  question_id: string;
  aggregation_type: string;
  result: Record<string, unknown>;
  computed_at: string;
}
