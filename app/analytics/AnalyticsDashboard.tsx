"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CARD_COLORS } from "@/lib/card-colors";

interface HeroData {
  totalOpened: number;
  gotPastName: number;
  completed: number;
  completionRate: number;
}

interface FunnelStage {
  stage: string;
  count: number;
  position?: number;
  isStart?: boolean;
}

interface SliderData {
  prompt: string;
  average: number | null;
  buckets: number[];
  count: number;
}

interface CardsData {
  prompt: string;
  distribution: { label: string; count: number }[];
  count: number;
}

interface LiveFeedItem {
  text: string;
  prompt: string;
  position: number;
  respondent: string;
  created_at: string;
}

interface Respondent {
  id: string;
  name: string | null;
  started_at: string;
  completed_at: string | null;
  identity_label: string | null;
  identity_summary: string | null;
  answered: number;
  total: number;
}

interface AnalyticsResponse {
  form: { id: string; title: string };
  since: string;
  generated_at: string;
  hero: HeroData;
  funnel: FunnelStage[];
  perQuestion: { id: string; position: number; prompt: string; input_type: string; answered: number; uniqueRespondents: number }[];
  slider: SliderData | null;
  cards: CardsData | null;
  identities: { label: string; count: number }[];
  liveFeed: LiveFeedItem[];
  respondents: Respondent[];
}

const POLL_MS = 15_000;

function fmtIst(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtTimeOnly(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setNowTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AnalyticsResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Re-render the "x ago" labels every 30s.
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!data && !error) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="font-matter text-sm text-zinc-400">Loading pulse…</div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="font-matter text-sm text-red-500">Couldn&apos;t load: {error}</div>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="min-h-screen bg-background px-5 pb-16 pt-8 md:px-10 md:pt-10">
      <div className="mx-auto max-w-6xl">
        <Header data={data} />
        <HeroGrid hero={data.hero} />
        <Funnel funnel={data.funnel} totalOpened={data.hero.totalOpened} />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {data.slider && <SliderPanel slider={data.slider} />}
          {data.cards && <CardsPanel cards={data.cards} />}
        </div>
        {data.identities.length > 0 && <IdentityPanel identities={data.identities} />}
        <LiveFeed items={data.liveFeed} />
        <RespondentTable respondents={data.respondents} />
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Header({ data }: { data: AnalyticsResponse }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="mb-8 flex flex-col gap-2 md:mb-10 md:flex-row md:items-end md:justify-between"
    >
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
          Pulse · live analytics
        </p>
        <h1
          className="mt-1 text-[2.25rem] leading-[1] tracking-tight text-zinc-900 md:text-[3rem]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {data.form.title}
        </h1>
        <p className="font-matter mt-2 text-sm text-zinc-500">
          All entries since launch · {fmtIst(data.since)} IST
        </p>
      </div>
      <div className="flex items-center gap-2 self-start md:self-end">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
          live · refreshes every 15s
        </span>
      </div>
    </motion.header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function HeroGrid({ hero }: { hero: HeroData }) {
  const cards = [
    { label: "Opened", value: hero.totalOpened, sub: "form loaded", color: CARD_COLORS[1] },
    { label: "Engaged", value: hero.gotPastName, sub: "got past name", color: CARD_COLORS[0] },
    { label: "Completed", value: hero.completed, sub: "all questions", color: CARD_COLORS[2] },
    {
      label: "Completion",
      value: `${hero.completionRate}%`,
      sub: "of opens",
      color: CARD_COLORS[3],
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.06, ease: "easeOut" }}
          className="relative overflow-hidden rounded-xl p-4 shadow-md md:p-5"
          style={{ background: c.color }}
        >
          <Grain />
          <p className="font-mono text-[9px] uppercase tracking-widest text-white/60">
            {c.label}
          </p>
          <p
            className="mt-2 text-[2.5rem] leading-none tracking-tight text-white md:text-[3.25rem]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {c.value}
          </p>
          <p className="font-mono mt-2 text-[10px] uppercase tracking-widest text-white/55">
            {c.sub}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Funnel({ funnel, totalOpened }: { funnel: FunnelStage[]; totalOpened: number }) {
  const max = Math.max(totalOpened, 1);
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="mt-8 rounded-2xl border border-zinc-200 bg-white p-5 md:p-7"
    >
      <SectionHeader eyebrow="Drop-off" title="Where people fall away" />
      <div className="mt-5 space-y-2.5">
        {funnel.map((stage, i) => {
          const pct = (stage.count / max) * 100;
          const prev = i > 0 ? funnel[i - 1].count : null;
          const dropPct =
            prev !== null && prev > 0
              ? Math.round(((prev - stage.count) / prev) * 100)
              : null;
          const isCliff = dropPct !== null && dropPct >= 50;
          return (
            <div key={i} className="group">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-matter truncate text-[13px] text-zinc-700 md:text-sm">
                  {i === 0 && "▶ "}
                  {stage.stage}
                </p>
                <p className="font-mono shrink-0 text-[11px] tabular-nums text-zinc-500">
                  {stage.count}
                  {dropPct !== null && (
                    <span className={isCliff ? "ml-2 text-red-500" : "ml-2 text-zinc-400"}>
                      {dropPct > 0 ? `↓ ${dropPct}%` : "—"}
                    </span>
                  )}
                </p>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: 0.05 * i, ease: [0.34, 1.1, 0.64, 1] }}
                  className="h-full rounded-full"
                  style={{
                    background: isCliff ? "#E8451A" : "#18181b",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SliderPanel({ slider }: { slider: SliderData }) {
  const max = Math.max(...slider.buckets, 1);
  const labels = ["0–20", "20–40", "40–60", "60–80", "80–100"];
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="rounded-2xl border border-zinc-200 bg-white p-5 md:p-7"
    >
      <SectionHeader eyebrow="Slider · Energy" title={slider.prompt} />
      <div className="mt-5 flex items-end gap-2">
        {slider.buckets.map((c, i) => {
          const h = (c / max) * 100;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <p className="font-mono text-[10px] tabular-nums text-zinc-500">{c}</p>
              <div className="relative h-32 w-full overflow-hidden rounded-md bg-zinc-100">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ duration: 0.7, delay: i * 0.05, ease: [0.34, 1.1, 0.64, 1] }}
                  className="absolute bottom-0 left-0 right-0"
                  style={{ background: CARD_COLORS[1] }}
                />
              </div>
              <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-400">
                {labels[i]}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-baseline justify-between border-t border-zinc-100 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
          Average
        </p>
        <p
          className="text-2xl tracking-tight text-zinc-900"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {slider.average ?? "—"}
          <span className="font-matter ml-1 text-xs text-zinc-400">/ 100</span>
        </p>
      </div>
    </motion.section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function CardsPanel({ cards }: { cards: CardsData }) {
  const max = Math.max(...cards.distribution.map((d) => d.count), 1);
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.35 }}
      className="rounded-2xl border border-zinc-200 bg-white p-5 md:p-7"
    >
      <SectionHeader eyebrow="Cards · Excitement" title={cards.prompt} />
      {cards.distribution.length === 0 ? (
        <p className="font-matter mt-5 text-sm text-zinc-400">No picks yet.</p>
      ) : (
        <div className="mt-5 space-y-2.5">
          {cards.distribution.map((d, i) => {
            const pct = (d.count / max) * 100;
            return (
              <div key={d.label}>
                <div className="flex items-baseline justify-between">
                  <p className="font-matter text-[13px] text-zinc-700">{d.label}</p>
                  <p className="font-mono text-[11px] tabular-nums text-zinc-500">{d.count}</p>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.7, delay: i * 0.06 }}
                    className="h-full rounded-full"
                    style={{ background: CARD_COLORS[i % CARD_COLORS.length] }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function IdentityPanel({
  identities,
}: {
  identities: { label: string; count: number }[];
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
      className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 md:p-7"
    >
      <SectionHeader
        eyebrow="Personas"
        title={`${identities.length} identit${identities.length === 1 ? "y" : "ies"} emerging`}
      />
      <div className="mt-5 flex flex-wrap gap-2">
        {identities.map((id, i) => (
          <motion.span
            key={id.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.06 }}
            className="font-matter inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
            style={{
              background: `${CARD_COLORS[i % CARD_COLORS.length]}10`,
              color: CARD_COLORS[i % CARD_COLORS.length],
              border: `1px solid ${CARD_COLORS[i % CARD_COLORS.length]}30`,
            }}
          >
            {id.label}
            <span className="font-mono text-[10px] tabular-nums opacity-70">×{id.count}</span>
          </motion.span>
        ))}
      </div>
    </motion.section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function LiveFeed({ items }: { items: LiveFeedItem[] }) {
  if (!items.length) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.45 }}
        className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 md:p-7"
      >
        <SectionHeader eyebrow="Live answers" title="What people are saying" />
        <p className="font-matter mt-5 text-sm text-zinc-400">No open-ended answers yet.</p>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.45 }}
      className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 md:p-7"
    >
      <SectionHeader eyebrow={`Live answers · ${items.length}`} title="What people are saying" />
      <div className="mt-5 space-y-3">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={`${item.created_at}-${item.respondent}`}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="rounded-xl bg-zinc-50 p-4"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="font-mono truncate text-[10px] uppercase tracking-widest text-zinc-400">
                  Q{item.position} · {item.respondent}
                </p>
                <p className="font-mono shrink-0 text-[10px] text-zinc-400">
                  {relativeTime(item.created_at)}
                </p>
              </div>
              <p className="font-matter text-[15px] leading-snug text-zinc-800">
                {item.text.length > 280 ? item.text.slice(0, 277) + "…" : item.text}
              </p>
              <p className="font-matter mt-1.5 text-[11px] italic text-zinc-400">
                on “{item.prompt}”
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RespondentTable({ respondents }: { respondents: Respondent[] }) {
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const completed = respondents.filter((r) => r.completed_at);
    const inProgress = respondents.filter((r) => !r.completed_at && r.answered > 0);
    const bounced = respondents.filter((r) => !r.completed_at && r.answered === 0);
    return { completed, inProgress, bounced };
  }, [respondents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return respondents;
    return respondents.filter((r) => {
      const name = (r.name ?? "").toLowerCase();
      const identity = (r.identity_label ?? "").toLowerCase();
      return name.includes(q) || identity.includes(q);
    });
  }, [respondents, search]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 md:p-7"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <SectionHeader
          eyebrow={`Respondents · ${respondents.length}`}
          title="Every session, newest first"
        />
        <div className="relative">
          <input
            type="search"
            placeholder="Search name or identity…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="font-matter w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none md:w-72"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="font-mono absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-zinc-400 hover:bg-zinc-100"
            >
              clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-b border-zinc-100 pb-4">
        <Stat label="Completed" value={groups.completed.length} accent={CARD_COLORS[2]} />
        <Stat label="In progress" value={groups.inProgress.length} accent={CARD_COLORS[0]} />
        <Stat label="Bounced" value={groups.bounced.length} accent="#a1a1aa" />
      </div>

      {search && (
        <p className="font-mono mt-3 text-[10px] uppercase tracking-widest text-zinc-400">
          {filtered.length} match{filtered.length === 1 ? "" : "es"} for &ldquo;{search}&rdquo;
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="font-mono text-left text-[10px] uppercase tracking-widest text-zinc-400">
              <th className="pb-2 pr-4 font-normal">Name</th>
              <th className="pb-2 pr-4 font-normal">Started</th>
              <th className="pb-2 pr-4 font-normal">Status</th>
              <th className="pb-2 pr-4 font-normal">Progress</th>
              <th className="pb-2 font-normal">Identity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const status = r.completed_at
                ? { label: "Completed", color: CARD_COLORS[2] }
                : r.answered > 0
                  ? { label: "In progress", color: CARD_COLORS[0] }
                  : { label: "Bounced", color: "#a1a1aa" };
              return (
                <tr key={r.id} className="border-t border-zinc-50">
                  <td className="font-matter py-2.5 pr-4 text-sm text-zinc-800">
                    {r.name && r.name !== "Unnamed" ? (
                      r.name
                    ) : (
                      <span className="text-zinc-400">{r.name === "Unnamed" ? "Anonymous" : "—"}</span>
                    )}
                  </td>
                  <td className="font-mono py-2.5 pr-4 text-xs tabular-nums text-zinc-500">
                    {fmtTimeOnly(r.started_at)}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className="font-mono inline-block rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest"
                      style={{
                        background: `${status.color}15`,
                        color: status.color,
                      }}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="font-mono py-2.5 pr-4 text-xs tabular-nums text-zinc-600">
                    {r.answered}/{r.total}
                  </td>
                  <td className="font-matter py-2.5 text-xs text-zinc-500">
                    {r.identity_label ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">{label}</p>
      <p
        className="mt-1 text-3xl tracking-tight"
        style={{ fontFamily: "var(--font-display)", color: accent }}
      >
        {value}
      </p>
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
        {eyebrow}
      </p>
      <h2
        className="mt-1.5 text-xl leading-tight tracking-tight text-zinc-900 md:text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
    </div>
  );
}

function Grain() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundSize: "180px 180px",
        opacity: 0.055,
        mixBlendMode: "overlay",
      }}
    />
  );
}
