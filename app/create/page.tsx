"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InputType, FormTone } from "@/lib/types";

// ─── Local draft types ────────────────────────────────────────────────────────

interface VisualOption {
  label: string;
  image_url: string;
}

interface DraftQuestion {
  _id: string;
  prompt: string;
  intent: string;
  input_type: InputType;
  options: string[] | VisualOption[];
  follow_up_enabled: boolean;
  required: boolean;
}

function makeQuestion(): DraftQuestion {
  return {
    _id: crypto.randomUUID(),
    prompt: "",
    intent: "",
    input_type: "voice",
    options: [],
    follow_up_enabled: false,
    required: true,
  };
}

const OPTIONS_TYPES: InputType[] = [
  "cards",
  "ranking",
  "this_or_that",
  "visual_select",
];

const INPUT_TYPE_LABELS: Record<InputType, string> = {
  name: "Name",
  voice: "Voice",
  text: "Text",
  emoji_slider: "Emoji Slider",
  cards: "Cards",
  ranking: "Ranking",
  this_or_that: "This or That",
  visual_select: "Visual Select",
};

// ─── Options editor ───────────────────────────────────────────────────────────

function OptionsEditor({
  inputType,
  options,
  onChange,
}: {
  inputType: InputType;
  options: string[] | VisualOption[];
  onChange: (opts: string[] | VisualOption[]) => void;
}) {
  const isVisual = inputType === "visual_select";
  const isThisOrThat = inputType === "this_or_that";
  const stringOpts = options as string[];
  const visualOpts = options as VisualOption[];
  const atMax = isThisOrThat && stringOpts.length >= 2;

  function addOption() {
    if (isVisual) {
      onChange([...visualOpts, { label: "", image_url: "" }]);
    } else {
      onChange([...stringOpts, ""]);
    }
  }

  function removeOption(i: number) {
    if (isVisual) {
      onChange(visualOpts.filter((_, idx) => idx !== i));
    } else {
      onChange(stringOpts.filter((_, idx) => idx !== i));
    }
  }

  function updateString(i: number, val: string) {
    const next = [...stringOpts];
    next[i] = val;
    onChange(next);
  }

  function updateVisual(i: number, field: "label" | "image_url", val: string) {
    const next = visualOpts.map((o, idx) =>
      idx === i ? { ...o, [field]: val } : o
    );
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Options</Label>
      {isVisual
        ? visualOpts.map((opt, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex-1 space-y-1">
                <Input
                  placeholder="Label"
                  value={opt.label}
                  onChange={(e) => updateVisual(i, "label", e.target.value)}
                />
                <Input
                  placeholder="Image URL"
                  value={opt.image_url}
                  onChange={(e) => updateVisual(i, "image_url", e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeOption(i)}
                className="mt-1 shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))
        : stringOpts.map((opt, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                placeholder={`Option ${i + 1}`}
                value={opt}
                onChange={(e) => updateString(i, e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeOption(i)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addOption}
        disabled={atMax}
        className="w-full"
      >
        <Plus className="h-3 w-3 mr-1" />
        {isThisOrThat ? `Add option (${stringOpts.length}/2)` : "Add option"}
      </Button>
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-2 text-sm select-none rounded px-2 py-1 transition-colors",
        checked
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full border-2",
          checked ? "bg-primary-foreground border-primary-foreground" : "border-muted-foreground"
        )}
      />
      {label}
    </button>
  );
}

// ─── Question card ────────────────────────────────────────────────────────────

function QuestionCard({
  question,
  index,
  onChange,
  onDelete,
}: {
  question: DraftQuestion;
  index: number;
  onChange: (q: DraftQuestion) => void;
  onDelete: () => void;
}) {
  const needsOptions = OPTIONS_TYPES.includes(question.input_type);

  function set<K extends keyof DraftQuestion>(key: K, value: DraftQuestion[K]) {
    onChange({ ...question, [key]: value });
  }

  function handleTypeChange(type: InputType) {
    const needsOpts = OPTIONS_TYPES.includes(type);
    const wasVisual = question.input_type === "visual_select";
    const isVisual = type === "visual_select";
    let options: string[] | VisualOption[] = question.options as string[];

    if (!needsOpts) {
      options = [];
    } else if (wasVisual && !isVisual) {
      options = (question.options as VisualOption[]).map((o) => o.label);
    } else if (!wasVisual && isVisual) {
      options = (question.options as string[]).map((l) => ({
        label: l,
        image_url: "",
      }));
    } else if (type === "this_or_that") {
      options = (question.options as string[]).slice(0, 2);
    }

    onChange({ ...question, input_type: type, options });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Question {index + 1}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>Prompt</Label>
          <Textarea
            placeholder="What do you want to ask?"
            value={question.prompt}
            onChange={(e) => set("prompt", e.target.value)}
            rows={2}
          />
        </div>

        <div className="space-y-1">
          <Label>
            Intent{" "}
            <span className="text-xs text-muted-foreground">(optional)</span>
          </Label>
          <Input
            placeholder="What are you trying to learn?"
            value={question.intent}
            onChange={(e) => set("intent", e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label>Input type</Label>
          <Select
            value={question.input_type}
            onValueChange={(v) => handleTypeChange(v as InputType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(INPUT_TYPE_LABELS) as InputType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {INPUT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {needsOptions && (
          <OptionsEditor
            inputType={question.input_type}
            options={question.options}
            onChange={(opts) => set("options", opts)}
          />
        )}

        <div className="flex gap-2 flex-wrap pt-1">
          <Toggle
            label="Follow-up"
            checked={question.follow_up_enabled}
            onChange={(v) => set("follow_up_enabled", v)}
          />
          <Toggle
            label="Required"
            checked={question.required}
            onChange={(v) => set("required", v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CreatePage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [tone, setTone] = useState<FormTone>("playful");
  const [questions, setQuestions] = useState<DraftQuestion[]>([makeQuestion()]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateQuestion(i: number, q: DraftQuestion) {
    setQuestions((qs) => qs.map((old, idx) => (idx === i ? q : old)));
  }

  function deleteQuestion(i: number) {
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  }

  function addQuestion() {
    setQuestions((qs) => [...qs, makeQuestion()]);
  }

  function validate(): string | null {
    if (!title.trim()) return "Form title is required.";
    if (questions.length === 0) return "Add at least one question.";
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.prompt.trim()) return `Question ${i + 1} is missing a prompt.`;
      if (OPTIONS_TYPES.includes(q.input_type)) {
        if (q.input_type === "this_or_that") {
          const opts = q.options as string[];
          if (opts.length < 2 || opts.some((o) => !o.trim()))
            return `Question ${i + 1} (This or That) requires exactly 2 non-empty options.`;
        } else {
          const opts = q.options as (string | VisualOption)[];
          if (opts.length === 0)
            return `Question ${i + 1} requires at least one option.`;
        }
      }
    }
    return null;
  }

  async function handlePublish() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setPublishing(true);

    try {
      const res = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          intent: intent.trim() || null,
          tone,
          questions: questions.map((q, i) => ({
            position: i,
            prompt: q.prompt.trim(),
            intent: q.intent.trim() || null,
            input_type: q.input_type,
            options: OPTIONS_TYPES.includes(q.input_type) ? q.options : null,
            follow_up_enabled: q.follow_up_enabled,
            required: q.required,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to publish.");
      }

      const { id } = await res.json();
      router.push(`/respond/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPublishing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create a form</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build your Pulse form. Questions will be asked in order.
          </p>
        </div>

        {/* Form meta */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                placeholder="e.g. Team retrospective"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>
                Intent{" "}
                <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                placeholder="What is this form trying to understand?"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Tone</Label>
              <Select
                value={tone}
                onValueChange={(v) => setTone(v as FormTone)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="playful">Playful</SelectItem>
                  <SelectItem value="calm">Calm</SelectItem>
                  <SelectItem value="direct">Direct</SelectItem>
                  <SelectItem value="insightful">Insightful</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Questions */}
        <div className="space-y-4">
          {questions.map((q, i) => (
            <QuestionCard
              key={q._id}
              question={q}
              index={i}
              onChange={(updated) => updateQuestion(i, updated)}
              onDelete={() => deleteQuestion(i)}
            />
          ))}
        </div>

        {/* Add question */}
        <Button variant="outline" className="w-full" onClick={addQuestion}>
          <Plus className="h-4 w-4 mr-2" />
          Add question
        </Button>

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive font-medium">{error}</p>
        )}

        {/* Publish */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2 items-center text-sm text-muted-foreground">
            <Badge variant="secondary">{questions.length} question{questions.length !== 1 ? "s" : ""}</Badge>
            <Badge variant="secondary">{tone}</Badge>
          </div>
          <Button onClick={handlePublish} disabled={publishing} size="lg">
            {publishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>
    </div>
  );
}
