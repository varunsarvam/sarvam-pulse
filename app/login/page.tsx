"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import Image from "next/image";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(false);
    setLoading(true);

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      setError(true);
      setPassword("");
    }
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-between bg-[#0d0d0d] px-6 py-10">
      {/* Top logo */}
      <div className="flex w-full justify-center pt-2">
        <Image src="/main-top-asset.png" alt="Pulse" width={52} height={52} className="opacity-70 invert" />
      </div>

      {/* Center form */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xs"
      >
        <h1 className="font-display mb-8 text-center text-3xl text-white">
          Enter password
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false); }}
            placeholder="Password"
            autoFocus
            className={
              "font-matter w-full rounded-2xl border bg-white/[0.07] px-5 py-4 text-base text-white outline-none placeholder:text-white/30 transition-colors " +
              (error
                ? "border-red-500/60 focus:border-red-400"
                : "border-white/10 focus:border-white/30")
            }
          />
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-matter text-center text-sm text-red-400"
            >
              Wrong password
            </motion.p>
          )}
          <button
            type="submit"
            disabled={!password || loading}
            className="font-matter mt-1 rounded-2xl bg-white py-4 text-base font-medium text-zinc-900 transition-all hover:bg-white/90 disabled:opacity-40"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </motion.div>

      {/* Bottom wordmark */}
      <div className="flex w-full justify-center pb-2">
        <Image src="/main-bottom-asset.png" alt="Intelligent Forms" width={160} height={28} className="opacity-30 invert" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
