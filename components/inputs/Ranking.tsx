"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { KeyboardSensor } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { GripVertical } from "lucide-react";
import type { Question } from "@/lib/types";

interface RankingProps {
  question: Question;
  options: string[];
  onSubmit: (value: { type: "ranking"; value: string[] }) => void;
  disabled?: boolean;
}

// ─── Sortable item ────────────────────────────────────────────────────────────

function SortableItem({
  id,
  rank,
  disabled,
}: {
  id: string;
  rank: number;
  disabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3.5 text-zinc-900 select-none transition-all duration-150 ${
        isDragging
          ? "border-zinc-400 opacity-95 scale-[1.02]"
          : "border-zinc-200"
      }`}
    >
      {/* Rank badge */}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground transition-all duration-200">
        {rank}
      </span>

      {/* Label */}
      <span className="flex-1 text-sm font-medium">{id}</span>

      {/* Drag handle */}
      <button
        className="cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing focus:outline-none disabled:cursor-not-allowed"
        disabled={disabled}
        {...attributes}
        {...(disabled ? {} : listeners)}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Ranking component ────────────────────────────────────────────────────────

export function Ranking({ question, options, onSubmit, disabled = false }: RankingProps) {
  const [items, setItems] = useState<string[]>(options);

  void question;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    if (disabled) return;
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.indexOf(String(active.id));
        const newIndex = prev.indexOf(String(over.id));
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  function submit() {
    onSubmit({ type: "ranking", value: items });
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <p className="text-xs text-muted-foreground">
        Drag to rank — top is highest priority
      </p>

      <DndContext
        sensors={disabled ? [] : sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {items.map((item, i) => (
              <SortableItem key={item} id={item} rank={i + 1} disabled={disabled} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button
        onClick={submit}
        disabled={disabled}
        className="group relative isolate mt-2 flex h-11 w-full items-center justify-center overflow-hidden rounded-full bg-[#111820] text-sm font-medium text-white transition-transform hover:scale-[1.02] hover:bg-[#0b1118] disabled:opacity-45"
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_45%)]" />
        <span className="pointer-events-none absolute -left-12 top-0 h-full w-12 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-96" />
        <span className="relative z-10">Lock in my ranking →</span>
      </button>
    </div>
  );
}
