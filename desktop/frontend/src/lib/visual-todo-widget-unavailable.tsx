import type { ComponentType } from "react";

type Annotation = {
  id: string;
  comment: string;
  element: string;
  elementPath: string;
  timestamp: number;
};

type WidgetProps = {
  onAnnotationAdd?: (annotation: Annotation) => void;
};

/**
 * Publication-safe fallback for the optional development annotation overlay.
 *
 * A developer can supply an independently installed overlay entrypoint with
 * VISUAL_TODO_WIDGET_PATH. Release and clean-checkout builds use this no-op
 * component, while durable TODO state continues to live under `.agensis/`.
 */
export const VisualTodo: ComponentType<WidgetProps> = () => null;

export function loadAllAnnotations<T = Annotation>(): Map<string, T[]> {
  return new Map();
}

export function saveAnnotations<T = Annotation>(
  _pathname: string,
  _annotations: T[],
): void {
  // Presentation state is optional; durable TODO state is persisted elsewhere.
}
