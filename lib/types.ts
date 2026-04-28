export type InputType =
  | "voice"
  | "text"
  | "emoji_slider"
  | "cards"
  | "ranking"
  | "this_or_that"
  | "visual_select";

export type FormTone = "playful" | "calm" | "direct" | "insightful";
export type FormStatus = "draft" | "published" | "closed";

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
