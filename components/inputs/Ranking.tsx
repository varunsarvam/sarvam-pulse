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
}

// ─── Sortable item ────────────────────────────────────────────────────────────

function SortableItem({ id, rank }: { id: string; rank: number }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-card-foreground shadow-sm select-none transition-shadow duration-150 ${
        isDragging
          ? "shadow-xl border-foreground/20 opacity-95 scale-[1.02]"
          : "border-border"
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
        className="cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing focus:outline-none"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Ranking component ────────────────────────────────────────────────────────

export function Ranking({ question, options, onSubmit }: RankingProps) {
  const [items, setItems] = useState<string[]>(options);

  void question;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
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
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {items.map((item, i) => (
              <SortableItem key={item} id={item} rank={i + 1} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button onClick={submit} className="w-full mt-2">
        Lock in my ranking
      </Button>
    </div>
  );
}
