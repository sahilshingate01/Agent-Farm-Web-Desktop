import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, Undo2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Customisable bento grid — a 12-column grid of panels the user can
 *  rearrange (drag the header grip, or the whole tile when chromeless)
 *  and resize (corner handle, snapping to grid units). Layout persists
 *  per storageKey; below the xl breakpoint it collapses to a stacked
 *  2-column flow with drag/resize disabled, matching how the fixed
 *  sections behaved before. */

const COLS = 12;
const ROW_REM = 4;
const GAP_REM = 0.75;
const MAX_ROWS = 24;

export interface BentoPanelSpec {
  id: string;
  /** Card panels render a header (title/caption/actions) over a scrolling
   *  body. Omitting the title keeps the card shell but drops the header —
   *  the grip floats over the content instead (the estate's CRT view).
   *  Chromeless tiles bring their own shell (metric tiles) and the whole
   *  tile is the drag handle. */
  title?: string;
  caption?: string;
  /** Header-right controls (lens pickers, nav buttons). */
  actions?: ReactNode;
  content: ReactNode;
  /** Default spans in grid units (columns × rows). */
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  chromeless?: boolean;
}

interface PanelSize {
  w: number;
  h: number;
}

interface BentoLayout {
  order: string[];
  sizes: Record<string, PanelSize>;
}

function defaultLayout(panels: BentoPanelSpec[]): BentoLayout {
  return {
    order: panels.map((panel) => panel.id),
    sizes: Object.fromEntries(
      panels.map((panel) => [panel.id, { w: panel.w, h: panel.h }]),
    ),
  };
}

function clampSize(panel: BentoPanelSpec, size: PanelSize): PanelSize {
  return {
    w: Math.min(COLS, Math.max(panel.minW ?? 2, Math.round(size.w))),
    h: Math.min(MAX_ROWS, Math.max(panel.minH ?? 2, Math.round(size.h))),
  };
}

/** Saved layout merged against the current panel set: unknown ids drop,
 *  panels added in later releases append in their default position. */
function loadLayout(storageKey: string, panels: BentoPanelSpec[]): BentoLayout {
  const fallback = defaultLayout(panels);
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<BentoLayout>;
    const known = new Set(fallback.order);
    const order = (Array.isArray(saved.order) ? saved.order : []).filter(
      (id): id is string => typeof id === "string" && known.has(id),
    );
    for (const id of fallback.order) if (!order.includes(id)) order.push(id);
    const sizes: Record<string, PanelSize> = {};
    for (const panel of panels) {
      const savedSize = saved.sizes?.[panel.id];
      sizes[panel.id] =
        savedSize && Number.isFinite(savedSize.w) && Number.isFinite(savedSize.h)
          ? clampSize(panel, savedSize)
          : { w: panel.w, h: panel.h };
    }
    return { order, sizes };
  } catch {
    return fallback;
  }
}

/** Tailwind xl. Media-query rem resolves against the 16px initial size —
 *  immune to the user's interface-size setting — so this tracks the same
 *  boundary as the xl: utilities. */
function useWideGrid(): boolean {
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 80rem)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 80rem)");
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return wide;
}

function ResizeHandle({
  active,
  onResizeStart,
}: {
  active: boolean;
  onResizeStart: (event: ReactPointerEvent) => void;
}) {
  return (
    <span
      role="presentation"
      title="Drag to resize"
      onPointerDown={onResizeStart}
      className={cn(
        "absolute bottom-0 right-0 z-10 grid size-5 cursor-nwse-resize place-items-end p-1 text-muted-foreground opacity-0 transition-opacity group-hover/bento:opacity-100",
        active && "text-primary opacity-100",
      )}
    >
      <svg
        viewBox="0 0 8 8"
        className="size-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        <path d="M1 7 7 1M4.5 7 7 4.5" />
      </svg>
    </span>
  );
}

function BentoItem({
  panel,
  size,
  wide,
  resizing,
  onResizeStart,
}: {
  panel: BentoPanelSpec;
  size: PanelSize;
  wide: boolean;
  resizing: boolean;
  onResizeStart: (event: ReactPointerEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: panel.id, disabled: !wide });
  // Translate only — rect sorting also emits scale, which distorts
  // mixed-size tiles mid-drag.
  const style: CSSProperties = wide
    ? {
        gridColumn: `span ${size.w} / span ${size.w}`,
        gridRow: `span ${size.h} / span ${size.h}`,
        transform: CSS.Translate.toString(transform),
        transition,
      }
    : {};

  if (panel.chromeless) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn(
          "group/bento relative min-w-0",
          wide ? "cursor-grab active:cursor-grabbing" : "col-span-1",
          isDragging && "z-20 opacity-60",
          resizing && "z-20",
        )}
      >
        {panel.content}
        {wide && <ResizeHandle active={resizing} onResizeStart={onResizeStart} />}
      </div>
    );
  }

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/bento relative flex min-w-0 flex-col overflow-hidden panel-depth rounded-lg border bg-card",
        wide ? "h-full" : "col-span-2",
        isDragging && "z-20 opacity-60",
        resizing && "z-20 border-primary/40",
      )}
    >
      {panel.title ? (
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="type-heading">{panel.title}</h2>
            {panel.caption && <p className="mt-1 type-caption">{panel.caption}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {panel.actions}
            {wide && (
              <button
                type="button"
                {...attributes}
                {...listeners}
                title="Drag to move"
                className="grid size-6 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/bento:opacity-100 active:cursor-grabbing"
              >
                <GripVerticalIcon className="size-3.5" />
              </button>
            )}
          </div>
        </header>
      ) : (
        wide && (
          <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-2">
            {panel.actions}
            <button
              type="button"
              {...attributes}
              {...listeners}
              title="Drag to move"
              className="grid size-6 shrink-0 cursor-grab place-items-center rounded-md border bg-card/80 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/bento:opacity-100 active:cursor-grabbing"
            >
              <GripVerticalIcon className="size-3.5" />
            </button>
          </div>
        )
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", wide && "overflow-y-auto")}>
        {panel.content}
      </div>
      {wide && <ResizeHandle active={resizing} onResizeStart={onResizeStart} />}
    </section>
  );
}

export function BentoGrid({
  storageKey,
  panels,
  className,
}: {
  storageKey: string;
  panels: BentoPanelSpec[];
  className?: string;
}) {
  const wide = useWideGrid();
  const [layout, setLayout] = useState<BentoLayout>(() =>
    loadLayout(storageKey, panels),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Panel set can change between releases — reconcile whenever the id set
  // does (content identity changing every render must NOT reset layout).
  const panelIds = panels.map((panel) => panel.id).join("|");
  useEffect(() => {
    setLayout(loadLayout(storageKey, panels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, panelIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      /* storage unavailable — layout stays session-local */
    }
  }, [storageKey, layout]);

  const byId = useMemo(
    () => new Map(panels.map((panel) => [panel.id, panel])),
    [panels],
  );
  const ordered = layout.order.flatMap((id) => {
    const panel = byId.get(id);
    return panel ? [panel] : [];
  });

  const customized = useMemo(() => {
    const initial = defaultLayout(panels);
    return (
      initial.order.join("|") !== layout.order.join("|") ||
      panels.some(
        (panel) =>
          layout.sizes[panel.id]?.w !== panel.w ||
          layout.sizes[panel.id]?.h !== panel.h,
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelIds, layout]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLayout((current) => {
      const from = current.order.indexOf(String(active.id));
      const to = current.order.indexOf(String(over.id));
      if (from < 0 || to < 0) return current;
      return { ...current, order: arrayMove(current.order, from, to) };
    });
  };

  const startResize = (panel: BentoPanelSpec, event: ReactPointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    // Keep the gesture out of the dnd sensors on chromeless tiles.
    event.preventDefault();
    event.stopPropagation();
    // Capture so embedded iframes (the estate panel) can't swallow the
    // pointermove stream mid-drag.
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const rootPx =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gapPx = GAP_REM * rootPx;
    const colPx =
      (container.getBoundingClientRect().width - gapPx * (COLS - 1)) / COLS;
    const rowPx = ROW_REM * rootPx;
    const start = layout.sizes[panel.id] || { w: panel.w, h: panel.h };
    const origin = { x: event.clientX, y: event.clientY };
    setResizingId(panel.id);
    const onMove = (move: PointerEvent) => {
      const dw = Math.round((move.clientX - origin.x) / (colPx + gapPx));
      const dh = Math.round((move.clientY - origin.y) / (rowPx + gapPx));
      setLayout((current) => {
        const next = clampSize(panel, { w: start.w + dw, h: start.h + dh });
        const prev = current.sizes[panel.id];
        if (prev && prev.w === next.w && prev.h === next.h) return current;
        return { ...current, sizes: { ...current.sizes, [panel.id]: next } };
      });
    };
    const onUp = () => {
      setResizingId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {wide && customized && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setLayout(defaultLayout(panels))}
            className="inline-flex items-center gap-1.5 type-label transition-colors hover:text-foreground"
          >
            <Undo2Icon className="size-3" />
            Reset layout
          </button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={layout.order} strategy={rectSortingStrategy}>
          <div
            ref={containerRef}
            className={cn(
              "grid gap-3",
              wide ? "grid-cols-12 grid-flow-row-dense" : "grid-cols-2",
              // Embedded iframes eat pointer events — freeze them while a
              // resize or reorder gesture is in flight.
              (resizingId || dragging) && "select-none [&_iframe]:pointer-events-none",
            )}
            style={wide ? { gridAutoRows: `${ROW_REM}rem` } : undefined}
          >
            {ordered.map((panel) => (
              <BentoItem
                key={panel.id}
                panel={panel}
                size={layout.sizes[panel.id] || { w: panel.w, h: panel.h }}
                wide={wide}
                resizing={resizingId === panel.id}
                onResizeStart={(event) => startResize(panel, event)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
