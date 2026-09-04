import { useEffect, useMemo, useState } from "react";
import {
  ChevronDownIcon,
  CopyIcon,
  FileDiffIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ReviewComment,
  WorkspaceDiffFile,
  WorkspaceDiffSnapshot,
} from "@/types/farm";
import "./review-surface.css";

type DiffLine = {
  key: string;
  kind: "context" | "addition" | "deletion" | "fold" | "meta";
  text: string;
  oldLine?: number;
  newLine?: number;
};

function parseHunkHeader(line: string) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] || 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] || 1),
  };
}

export function parseUnifiedPatch(file: WorkspaceDiffFile): DiffLine[] {
  if (!file.patch) return [];
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let previousOldEnd = 0;
  let hunk = 0;
  for (const source of file.patch.split("\n")) {
    const header = parseHunkHeader(source);
    if (header) {
      const unchanged = Math.max(0, header.oldStart - previousOldEnd - 1);
      result.push({
        key: `fold-${hunk}`,
        kind: "fold",
        text: unchanged ? `${unchanged} unmodified lines` : source,
      });
      oldLine = header.oldStart;
      newLine = header.newStart;
      previousOldEnd = header.oldStart + header.oldCount - 1;
      hunk += 1;
      continue;
    }
    if (
      source.startsWith("diff --git") ||
      source.startsWith("index ") ||
      source.startsWith("new file mode") ||
      source.startsWith("deleted file mode") ||
      source.startsWith("similarity index") ||
      source.startsWith("rename from") ||
      source.startsWith("rename to") ||
      source.startsWith("--- ") ||
      source.startsWith("+++ ") ||
      source === "\\ No newline at end of file"
    ) {
      continue;
    }
    if (source.startsWith("+")) {
      result.push({
        key: `add-${hunk}-${newLine}`,
        kind: "addition",
        text: source.slice(1),
        newLine,
      });
      newLine += 1;
      continue;
    }
    if (source.startsWith("-")) {
      result.push({
        key: `del-${hunk}-${oldLine}`,
        kind: "deletion",
        text: source.slice(1),
        oldLine,
      });
      oldLine += 1;
      continue;
    }
    if (oldLine || newLine) {
      result.push({
        key: `ctx-${hunk}-${oldLine}-${newLine}`,
        kind: "context",
        text: source.startsWith(" ") ? source.slice(1) : source,
        oldLine,
        newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }
  if (file.totalLines && newLine && file.totalLines >= newLine) {
    const unchanged = file.totalLines - newLine + 1;
    if (unchanged > 0) {
      result.push({
        key: "fold-end",
        kind: "fold",
        text: `${unchanged} unmodified lines`,
      });
    }
  }
  return result;
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="review-diff-stat" aria-label={`${additions} additions, ${deletions} deletions`}>
      <span className="review-addition">+{additions}</span>
      <span className="review-deletion">-{deletions}</span>
    </span>
  );
}

export function ReviewCommentChip({
  comment,
  onRemove,
}: {
  comment: ReviewComment;
  onRemove: () => void;
}) {
  return (
    <div className="review-comment-chip">
      <MessageSquareIcon />
      <button type="button" className="review-comment-chip-body" title={comment.body}>
        <span>{comment.file}</span>
        <span>R{comment.line}</span>
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove comment on ${comment.file}`}>
        <XIcon />
      </button>
    </div>
  );
}

export function ReviewSummaryCard({
  snapshot,
  onReview,
}: {
  snapshot: WorkspaceDiffSnapshot;
  onReview: (path?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!snapshot.files.length) return null;
  const visible = expanded ? snapshot.files : snapshot.files.slice(0, 3);
  return (
    <section className="review-summary-card">
      <header>
        <div className="review-summary-icon"><FileDiffIcon /></div>
        <div className="min-w-0 flex-1">
          <strong>Edited {snapshot.files.length} {snapshot.files.length === 1 ? "file" : "files"}</strong>
          <DiffStat additions={snapshot.additions} deletions={snapshot.deletions} />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onReview()}>
          Review
        </Button>
      </header>
      <div className="review-summary-files">
        {visible.map((file) => (
          <button type="button" key={file.path} onClick={() => onReview(file.path)}>
            <span>{file.path}</span>
            <DiffStat additions={file.additions} deletions={file.deletions} />
          </button>
        ))}
      </div>
      {snapshot.files.length > 3 ? (
        <button type="button" className="review-summary-more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer files" : `Show ${snapshot.files.length - 3} more files`}
          <ChevronDownIcon className={cn(expanded && "rotate-180")} />
        </button>
      ) : null}
    </section>
  );
}

function ReviewDiff({
  file,
  comments,
  onAddComment,
}: {
  file: WorkspaceDiffFile;
  comments: ReviewComment[];
  onAddComment: (comment: ReviewComment) => void;
}) {
  const lines = useMemo(() => parseUnifiedPatch(file), [file]);
  const [commentLine, setCommentLine] = useState<DiffLine | null>(null);
  const [draft, setDraft] = useState("");
  const submit = () => {
    if (!commentLine || !draft.trim()) return;
    const line = commentLine.newLine || commentLine.oldLine;
    if (!line) return;
    onAddComment({
      id: crypto.randomUUID(),
      file: file.path,
      line,
      side: commentLine.kind === "deletion" ? "old" : "new",
      body: draft.trim(),
    });
    setDraft("");
    setCommentLine(null);
  };
  if (!file.patch) {
    return (
      <div className="review-empty-diff">
        <FileDiffIcon />
        <strong>Binary or oversized change</strong>
        <p>The file is changed, but there is no text patch to render.</p>
      </div>
    );
  }
  return (
    <div className="review-code" role="table" aria-label={`Changes in ${file.path}`}>
      {lines.map((line) => {
        if (line.kind === "fold") {
          return <div key={line.key} className="review-fold-row">{line.text}</div>;
        }
        const lineNumber = line.newLine || line.oldLine;
        const lineComments = comments.filter(
          (comment) => comment.file === file.path && comment.line === lineNumber,
        );
        return (
          <div key={line.key}>
            <div className={cn("review-code-row", `is-${line.kind}`)}>
              <button
                type="button"
                className="review-line-comment"
                aria-label={`Comment on line ${lineNumber}`}
                onClick={() => setCommentLine(line)}
              >
                <span>+</span>
              </button>
              <span className="review-old-line">{line.oldLine || ""}</span>
              <span className="review-new-line">{line.newLine || ""}</span>
              <code>{line.text || " "}</code>
            </div>
            {lineComments.map((comment) => (
              <div className="review-inline-comment" key={comment.id}>
                <MessageSquareIcon />
                <div><strong>Local comment</strong><p>{comment.body}</p></div>
                <span>R{comment.line}</span>
              </div>
            ))}
            {commentLine?.key === line.key ? (
              <div className="review-comment-editor">
                <header><MessageSquareIcon /><strong>Local comment</strong><span>Comment on line R{lineNumber}</span></header>
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Request change"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
                  }}
                />
                <footer>
                  <Button type="button" variant="ghost" onClick={() => setCommentLine(null)}>Cancel</Button>
                  <Button type="button" onClick={submit} disabled={!draft.trim()}>Comment</Button>
                </footer>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ReviewSurface({
  snapshot,
  selectedPath,
  onSelectedPathChange,
  comments,
  onAddComment,
  onRefresh,
  loading = false,
  error,
}: {
  snapshot: WorkspaceDiffSnapshot | null;
  selectedPath?: string | null;
  onSelectedPathChange: (path: string) => void;
  comments: ReviewComment[];
  onAddComment: (comment: ReviewComment) => void;
  onRefresh: () => void;
  loading?: boolean;
  error?: string | null;
}) {
  const selected = snapshot?.files.find((file) => file.path === selectedPath) || snapshot?.files[0];
  useEffect(() => {
    if (selected && selected.path !== selectedPath) onSelectedPathChange(selected.path);
  }, [selected?.path, selectedPath, onSelectedPathChange]);
  return (
    <section className="review-surface">
      <header className="review-surface-header">
        <div>
          <strong>Review</strong>
          {snapshot ? <DiffStat additions={snapshot.additions} deletions={snapshot.deletions} /> : null}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRefresh} disabled={loading} aria-label="Refresh changes">
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
        </Button>
      </header>
      {error ? <div className="review-error">{error}</div> : null}
      {!snapshot?.files.length && !loading ? (
        <div className="review-empty-diff">
          <FileDiffIcon />
          <strong>No working tree changes</strong>
          <p>Changes made by an agent will appear here.</p>
        </div>
      ) : (
        <div className="review-surface-layout">
          <nav className="review-file-list" aria-label="Changed files">
            {snapshot?.files.map((file) => (
              <button
                type="button"
                key={file.path}
                className={cn(selected?.path === file.path && "is-selected")}
                onClick={() => onSelectedPathChange(file.path)}
              >
                <span>{file.path}</span>
                <DiffStat additions={file.additions} deletions={file.deletions} />
              </button>
            ))}
          </nav>
          <div className="review-file-detail">
            {selected ? (
              <>
                <header className="review-file-header">
                  <FileDiffIcon />
                  <strong title={selected.path}>{selected.path}</strong>
                  <DiffStat additions={selected.additions} deletions={selected.deletions} />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => navigator.clipboard.writeText(selected.patch)} aria-label="Copy patch">
                    <CopyIcon />
                  </Button>
                </header>
                <ReviewDiff file={selected} comments={comments} onAddComment={onAddComment} />
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
