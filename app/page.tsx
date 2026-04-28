import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-6xl font-bold tracking-tight">Pulse</h1>
      <div className="flex gap-4">
        <Link
          href="/create"
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Create a form
        </Link>
        <Link
          href="/respond/demo"
          className="rounded-md border border-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Try a demo
        </Link>
      </div>
    </main>
  );
}
