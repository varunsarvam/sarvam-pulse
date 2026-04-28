# Pulse Code Conventions

## File structure

app/

├── page.tsx                       # homepage

├── create/page.tsx                # creator form

├── respond/[formId]/page.tsx      # respondent flow

├── share/[sessionId]/page.tsx     # public share page

└── api/

```
├── forms/route.ts

├── sessions/route.ts

├── answers/route.ts

├── reactions/route.ts

├── transcribe/route.ts

├── speak/route.ts

├── phrase-question/route.ts

├── follow-up/route.ts

├── normalize/route.ts          # internal use, called from answers route

└── complete-session/route.ts
```

components/

├── ui/                             # shadcn primitives

├── inputs/                         # one file per input type

│   ├── VoiceInput.tsx

│   ├── TextInput.tsx

│   ├── EmojiSlider.tsx

│   ├── Cards.tsx

│   ├── Ranking.tsx

│   ├── ThisOrThat.tsx

│   └── VisualSelect.tsx

├── Reflection.tsx

├── AIPresence.tsx                  # the left-column avatar

├── EntryScreen.tsx

├── QuestionStage.tsx

├── ReflectionStage.tsx

└── CompletionStage.tsx

lib/

├── supabase/

│   ├── client.ts                   # browser client (anon key)

│   └── server.ts                   # server client (service role key)

├── sarvam.ts                       # Sarvam API wrappers

├── reflection.ts                   # pickReflection() and templates

├── llm.ts                          # higher-level LLM helpers (normalize, phrase, etc)

└── types.ts                        # shared TypeScript types

scripts/

└── seed.ts                         # demo data seeder

docs/                               # context docs (this folder)

.cursorrules

## Naming

- Components: PascalCase, named export `export function VoiceInput()`)
- Hooks: camelCase, named export `export function useRealtimeCount()`)
- Utils: camelCase, named export
- Types: PascalCase, in lib/types.ts
- Constants: UPPER_SNAKE_CASE
- API route handlers: always `export async function GET/POST(req: Request)`

## Server vs client component decision

- Default to server component
- Add "use client" only when you need: useState, useEffect, event handlers, browser APIs (MediaRecorder, audio playback), Framer Motion
- All input components → client
- Stage components → client
- Page-level files → server, with client child components

## Patterns

### Fetching in server components

```typescript

import { createServerClient } from "@/lib/supabase/server";

export default async function Page({ params }: { params: { formId: string } }) {

  const supabase = createServerClient();

  const { data: form } = await supabase

    .from("forms")

    .select("*, questions(*)")

    .eq("id", params.formId)

    .single();

  

  if (!form) notFound();

  return <RespondentFlow form={form} />;

}

```

### API route pattern

```typescript

import { NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {

  try {

    const body = await req.json();

    // ... do work

    return NextResponse.json({ ok: true, /* data */ });

  } catch (e) {

    console.error(e);

    return NextResponse.json({ error: "Internal error" }, { status: 500 });

  }

}

```

### Client-side mutation pattern

```typescript

const submit = async (value: any) => {

  const res = await fetch("/api/answers", {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({ session_id, question_id, raw_value: value })

  });

  const data = await res.json();

  // handle response

};

```

### Realtime subscription pattern

```typescript

"use client";

import { useEffect, useState } from "react";

import { createBrowserClient } from "@/lib/supabase/client";

export function useLiveCount(formId: string) {

  const [count, setCount] = useState(0);

  

  useEffect(() => {

    const supabase = createBrowserClient();

    

    // initial fetch

    supabase.from("sessions").select("id", { count: "exact" })

      .eq("form_id", formId).then(({ count }) => setCount(count ?? 0));

    

    // subscribe

    const channel = [supabase.channel](http://supabase.channel)`sessions:${formId}`)

      .on("postgres_changes", 

        { event: "INSERT", schema: "public", table: "sessions", filter: `form_id=eq.${formId}` },

        () => setCount(c => c + 1))

      .subscribe();

    

    return () => { supabase.removeChannel(channel); };

  }, [formId]);

  

  return count;

}

```

