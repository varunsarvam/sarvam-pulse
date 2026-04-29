"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let popIdCounter = 0;

export interface ReactionPop {
  id: number;
  emoji: string;
}

const REACTION_EMOJI: Record<string, string> = {
  fire: "🔥",
  eyes: "👀",
  hundred: "💯",
  thinking: "🤔",
};

const DEBOUNCE_MS = 1500;

export function useLiveData(formId: string, questionIds: string[]) {
  const [count, setCount] = useState(0);
  const [quotes, setQuotes] = useState<string[]>([]);
  const [reactionCount, setReactionCount] = useState(0);
  const [reactionPops, setReactionPops] = useState<ReactionPop[]>([]);

  const countRef = useRef(0);
  const quotesRef = useRef<string[]>([]);
  const reactionCountRef = useRef(0);
  const dirtyRef = useRef(false);

  const qIdsKey = questionIds.join(",");

  useEffect(() => {
    const interval = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setCount(countRef.current);
      setQuotes([...quotesRef.current]);
      setReactionCount(reactionCountRef.current);
    }, DEBOUNCE_MS);
    return () => clearInterval(interval);
  }, []);

  const pushPop = useCallback((emoji: string) => {
    const id = ++popIdCounter;
    setReactionPops((prev) => [...prev, { id, emoji }]);
    setTimeout(() => {
      setReactionPops((prev) => prev.filter((p) => p.id !== id));
    }, 1200);
  }, []);

  useEffect(() => {
    if (!formId) return;

    const supabase = createClient();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .gte("started_at", since24h)
      .then(({ count: c }) => {
        countRef.current = c ?? 0;
        setCount(c ?? 0);
      });

    if (questionIds.length > 0) {
      supabase
        .from("aggregations")
        .select("recent_quotes")
        .in("question_id", questionIds)
        .then(({ data }) => {
          const all =
            data?.flatMap((r) => (r.recent_quotes as string[]) ?? []) ?? [];
          const shuffled = shuffle(all);
          quotesRef.current = shuffled;
          setQuotes(shuffled);
        });

      supabase
        .from("reactions")
        .select("id", { count: "exact", head: true })
        .in("question_id", questionIds)
        .gte("created_at", since1h)
        .then(({ count: c }) => {
          reactionCountRef.current = c ?? 0;
          setReactionCount(c ?? 0);
        });
    }

    // ── Realtime: sessions ──
    const sessionChannel = supabase
      .channel(`live-sessions-${formId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sessions",
          filter: `form_id=eq.${formId}`,
        },
        () => {
          countRef.current += 1;
          dirtyRef.current = true;
        }
      )
      .subscribe();

    // ── Realtime: aggregations (quotes) ──
    const qSet = new Set(questionIds);
    const aggChannel = supabase
      .channel(`live-agg-${formId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "aggregations" },
        (payload) => {
          const updated = payload.new as {
            question_id: string;
            recent_quotes: string[];
          };
          if (!qSet.has(updated.question_id)) return;
          const fresh = updated.recent_quotes ?? [];
          const prev = quotesRef.current;
          const merged = [...fresh, ...prev.filter((q) => !fresh.includes(q))];
          quotesRef.current = shuffle(merged).slice(0, 30);
          dirtyRef.current = true;
        }
      )
      .subscribe();

    // ── Realtime: reactions ──
    const reactionChannel = supabase
      .channel(`live-reactions-${formId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions" },
        (payload) => {
          const row = payload.new as { question_id: string; reaction: string };
          if (!qSet.has(row.question_id)) return;
          reactionCountRef.current += 1;
          dirtyRef.current = true;
          const emoji = REACTION_EMOJI[row.reaction];
          if (emoji) pushPop(emoji);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(aggChannel);
      supabase.removeChannel(reactionChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, qIdsKey, pushPop]);

  return { count, quotes, reactionCount, reactionPops };
}
