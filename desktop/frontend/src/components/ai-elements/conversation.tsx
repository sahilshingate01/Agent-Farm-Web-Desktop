import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type UIEvent,
} from "react";
import { ArrowDownIcon, BotIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Distance from the bottom (px) that still counts as "following" the stream. */
const NEAR_BOTTOM_PX = 96;

export function Conversation({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Prefer a ref so ResizeObserver / MutationObserver never close over stale state.
  const stickToBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const distanceFromBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return 0;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }, []);

  const isNearBottom = useCallback(
    () => distanceFromBottom() <= NEAR_BOTTOM_PX,
    [distanceFromBottom],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollerRef.current;
    if (!el) return;
    if (behavior === "smooth") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      // Instant pin while streaming — smooth would lag and fight the user.
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    // Ignore programmatic scrolls that set stick=true; measure after layout.
    const near = isNearBottom();
    stickToBottomRef.current = near;
    setShowJump(!near);
    props.onScroll?.(event);
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const pinIfFollowing = () => {
      if (!stickToBottomRef.current) {
        // Content grew above us — keep jump visible if still away from bottom.
        setShowJump(!isNearBottom());
        return;
      }
      scrollToBottom("auto");
      setShowJump(false);
    };

    // Content height changes (new tokens, tool rows, expand/collapse).
    const ro = new ResizeObserver(pinIfFollowing);
    const content = el.firstElementChild;
    if (content instanceof HTMLElement) ro.observe(content);
    ro.observe(el);

    // Streaming text nodes / new messages.
    const mo = new MutationObserver(pinIfFollowing);
    mo.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Mount / session switch: start at bottom.
    stickToBottomRef.current = true;
    pinIfFollowing();

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [isNearBottom, scrollToBottom]);

  const { onScroll: _ignored, ...rest } = props;

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div
        ref={scrollerRef}
        role="log"
        aria-live="polite"
        onScroll={onScroll}
        className="scrollbar-none absolute inset-0 overflow-y-auto"
        {...rest}
      >
        {children}
      </div>
      {showJump ? (
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border shadow-md"
          aria-label="Jump to latest messages"
          title="Jump to latest"
          onClick={() => {
            stickToBottomRef.current = true;
            scrollToBottom("smooth");
            setShowJump(false);
          }}
        >
          <ArrowDownIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export function ConversationContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex min-h-full flex-col gap-7 p-6", className)}
      {...props}
    />
  );
}

export function ConversationEmptyState({
  title = "Test the route",
  description = "Messages stay in this window. Send one when the gateway is online.",
  icon,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="m-auto flex max-w-xl flex-col items-center gap-3 py-12 text-center">
      <div className="grid size-11 place-items-center rounded-xl border bg-muted/60 text-muted-foreground">
        {icon ?? <BotIcon />}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="type-title">{title}</h3>
        <p className="type-body text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
