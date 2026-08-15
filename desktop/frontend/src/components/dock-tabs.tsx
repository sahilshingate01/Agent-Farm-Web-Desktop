import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PinIcon, XIcon } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export type DockDropZone = "move" | "split-left" | "split-right" | "split-top" | "split-bottom";

export type DockTabItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  dirty?: boolean;
  closable?: boolean;
  disabled?: boolean;
  pinned?: boolean;
};

type ReorderHandler = (draggedId: string, targetId: string) => void;
type DockContextValue = {
  registerReorder: (handler?: ReorderHandler) => void;
  setDragLabel: (id: string, label: ReactNode) => void;
};

const DockContext = createContext<DockContextValue | null>(null);
const sortableId = (id: string) => `dock-tab:${id}`;
const surfaceId = (id: string) => `dock-surface:${id}`;

const zoneLabels: Record<DockDropZone, string> = {
  move: "Move here",
  "split-left": "Split left",
  "split-right": "Split right",
  "split-top": "Split top",
  "split-bottom": "Split bottom",
};

function zoneForPoint(
  x: number,
  y: number,
  bounds: DOMRect,
  zones: DockDropZone[],
): DockDropZone {
  const rx = (x - bounds.left) / Math.max(bounds.width, 1);
  const ry = (y - bounds.top) / Math.max(bounds.height, 1);
  const edge = 0.24;
  const candidate: DockDropZone = rx < edge
    ? "split-left"
    : rx > 1 - edge
      ? "split-right"
      : ry < edge
        ? "split-top"
        : ry > 1 - edge
          ? "split-bottom"
          : "move";
  return zones.includes(candidate) ? candidate : "move";
}

function SortableTab({
  tab,
  active,
  onActivate,
  onClose,
  onDoubleClick,
  renderMenu,
}: {
  tab: DockTabItem;
  active: boolean;
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  renderMenu?: (id: string) => ReactNode;
}) {
  const dock = useContext(DockContext);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: sortableId(tab.id),
    data: { type: "dock-tab", tabId: tab.id },
    disabled: tab.disabled,
  });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  const tabNode = (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        dock?.setDragLabel(tab.id, tab.label);
        listeners?.onPointerDown?.(event);
      }}
      onDoubleClick={() => onDoubleClick?.(tab.id)}
      data-dragging={isDragging || undefined}
      data-drop-target={isOver || undefined}
      className={cn(
        "dock-tab group relative flex h-9 min-w-28 max-w-56 shrink-0 cursor-grab items-center gap-1 rounded-md border px-2 type-list shadow-sm transition-[background,border-color,color,opacity,transform] active:cursor-grabbing",
        active
          ? "border-border bg-background text-foreground shadow-sm"
          : "border-transparent bg-muted/45 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
        isDragging && "z-50 opacity-30",
        isOver && !isDragging && "border-primary/60 bg-primary/10",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={tab.disabled}
        onClick={() => onActivate(tab.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        {tab.pinned ? <PinIcon className="size-3 shrink-0 text-muted-foreground" /> : tab.icon}
        <span className="truncate">{tab.label}</span>
        {tab.dirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
        {tab.badge}
      </button>
      {tab.closable !== false && !tab.pinned && onClose && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose(tab.id);
          }}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Close ${typeof tab.label === "string" ? tab.label : "tab"}`}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );

  if (!renderMenu) return tabNode;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tabNode}</ContextMenuTrigger>
      <ContextMenuContent>{renderMenu(tab.id)}</ContextMenuContent>
    </ContextMenu>
  );
}

export function DockTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onReorder,
  onDoubleClick,
  renderTabMenu,
  trailing,
  actions,
  ariaLabel = "Tabs",
  className,
}: {
  tabs: DockTabItem[];
  activeId: string | null | undefined;
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: ReorderHandler;
  onDoubleClick?: (id: string) => void;
  /** Per-tab context menu body (ContextMenuItem/Separator children). */
  renderTabMenu?: (id: string) => ReactNode;
  /** Rendered inside the strip after the last tab (e.g. a new-tab button). */
  trailing?: ReactNode;
  actions?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const dock = useContext(DockContext);
  useEffect(() => {
    dock?.registerReorder(onReorder);
    return () => dock?.registerReorder(undefined);
  }, [dock, onReorder]);

  return (
    <header className={cn("dock-tabs flex min-w-0 items-center border-b", className)}>
      <SortableContext items={tabs.map((tab) => sortableId(tab.id))} strategy={horizontalListSortingStrategy}>
        <div role="tablist" aria-label={ariaLabel} className="dock-tabs-strip flex h-11 min-w-0 flex-1 items-center gap-1 overflow-x-auto px-3 scrollbar-none">
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onActivate={onActivate}
              onClose={onClose}
              onDoubleClick={onDoubleClick}
              renderMenu={renderTabMenu}
            />
          ))}
          {trailing}
        </div>
      </SortableContext>
      {actions && <div className="dock-tabs-actions flex h-11 shrink-0 items-center gap-1 px-3">{actions}</div>}
    </header>
  );
}

function DockSurface({
  id,
  children,
  className,
  active,
  zone,
  zones,
  label,
  hostRef,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  active: boolean;
  zone: DockDropZone;
  zones: DockDropZone[];
  label: string;
  hostRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const { setNodeRef } = useDroppable({ id: surfaceId(id), data: { type: "dock-surface" } });
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        hostRef.current = node;
      }}
      className={cn("dock-drop-target relative min-h-0", className)}
    >
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-40 p-3" aria-hidden>
          <div className="grid h-full min-h-32 grid-cols-[0.7fr_1.6fr_0.7fr] grid-rows-[0.7fr_1.6fr_0.7fr] gap-2 rounded-xl border border-primary/50 bg-primary/5 p-2 shadow-2xl backdrop-blur-sm">
            {zones.map((item) => (
              <div
                key={item}
                className={cn(
                  "grid place-items-center rounded-lg border border-dashed border-primary/35 bg-background/65 text-xs font-medium text-primary/80",
                  item === "split-left" && "row-start-2",
                  item === "split-top" && "col-start-2 row-start-1",
                  item === "split-right" && "col-start-3 row-start-2",
                  item === "split-bottom" && "col-start-2 row-start-3",
                  item === "move" && "col-start-2 row-start-2",
                  item === zone && "border-primary bg-primary/20 text-primary shadow-inner",
                )}
              >
                {item === zone ? label : zoneLabels[item]}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DockDropTarget({
  children,
  onDrop,
  className,
  disabled = false,
  label = "Drop tab to dock",
  zones,
}: {
  children: ReactNode;
  onDrop: (id: string, zone: DockDropZone) => void;
  className?: string;
  disabled?: boolean;
  label?: string;
  zones?: DockDropZone[];
}) {
  const rawId = useId();
  const id = rawId.replace(/:/g, "");
  const allowedZones = useMemo<DockDropZone[]>(
    () => zones || ["move", "split-left", "split-right", "split-top", "split-bottom"],
    [zones],
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const reorderRef = useRef<ReorderHandler | undefined>(undefined);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragLabel, setDragLabelState] = useState<ReactNode>(null);
  const [zone, setZone] = useState<DockDropZone>("move");
  const [surfaceActive, setSurfaceActive] = useState(false);

  const registerReorder = useCallback((handler?: ReorderHandler) => {
    reorderRef.current = handler;
  }, []);
  const setDragLabel = useCallback((nextId: string, nextLabel: ReactNode) => {
    setDragId(nextId);
    setDragLabelState(nextLabel);
  }, []);
  const context = useMemo(() => ({ registerReorder, setDragLabel }), [registerReorder, setDragLabel]);

  const updateZone = (event: DragMoveEvent) => {
    const translated = event.active.rect.current.translated;
    const host = hostRef.current;
    if (!translated || !host) return;
    const bounds = host.getBoundingClientRect();
    const centerX = translated.left + translated.width / 2;
    const centerY = translated.top + translated.height / 2;
    const inside = centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
    setSurfaceActive(inside);
    if (inside) setZone(zoneForPoint(centerX, centerY, bounds, allowedZones));
  };
  const reset = () => {
    setDragId(null);
    setDragLabelState(null);
    setZone("move");
    setSurfaceActive(false);
  };
  const finish = (event: DragEndEvent) => {
    const activeId = event.active.data.current?.tabId as string | undefined;
    const targetId = event.over?.data.current?.tabId as string | undefined;
    if (activeId && targetId && activeId !== targetId) {
      reorderRef.current?.(activeId, targetId);
    } else if (activeId && surfaceActive && !disabled) {
      onDrop(activeId, zone);
    }
    reset();
  };

  return (
    <DockContext.Provider value={context}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(event: DragStartEvent) => {
          setDragId(event.active.data.current?.tabId as string | undefined || null);
        }}
        onDragMove={updateZone}
        onDragCancel={reset}
        onDragEnd={finish}
      >
        <DockSurface
          id={id}
          className={cn(className, disabled && "pointer-events-none")}
          active={Boolean(dragId && surfaceActive && !disabled)}
          zone={zone}
          zones={allowedZones}
          label={label}
          hostRef={hostRef}
        >
          {children}
        </DockSurface>
        <DragOverlay dropAnimation={null}>
          {dragId ? (
            <div className="flex h-9 max-w-56 items-center rounded-md border border-primary/50 bg-background px-3 type-list text-foreground shadow-xl">
              <span className="truncate">{dragLabel || dragId}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </DockContext.Provider>
  );
}
