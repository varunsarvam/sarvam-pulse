"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useLiveData(formId: string, questionIds: string[]) {
  const [count, setCount] = useState(0);
  const [quotes, setQuotes] = useState<string[]>([]);

  const qIdsKey = questionIds.join(",");

  useEffect(() => {
    if (!formId) return;

    const supabase = createClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .gte("started_at", since)
      .then(({ count }) => setCount(count ?? 0));

    if (questionIds.length > 0) {
      supabase
        .from("aggregations")
        .select("recent_quotes")
        .in("question_id", questionIds)
        .then(({ data }) => {
          const all =
            data?.flatMap((r) => (r.recent_quotes as string[]) ?? []) ?? [];
          setQuotes(shuffle(all));
        });
    }

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
        () => setCount((c) => c + 1)
      )
      .subscribe();

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
          setQuotes((prev) => {
            const merged = [
              ...fresh,
              ...prev.filter((q) => !fresh.includes(q)),
            ];
            return shuffle(merged).slice(0, 30);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(aggChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, qIdsKey]);

  return { count, quotes };
}
