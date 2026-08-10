declare module "visual-todo-widget" {
  import type { ComponentType } from "react";

  export type VisualTodoAnnotationStatus = "todo" | "in-progress" | "done";
  export type VisualTodoAgentProvider = "auto" | "claude-code" | "codex" | "custom";
  export type VisualTodoAgentDispatch = {
    provider: VisualTodoAgentProvider;
    model?: string;
    projectId?: string;
    output: string;
    annotations: VisualTodoAnnotation[];
    url?: string;
  };

  export type VisualTodoAnnotation = {
    id: string;
    comment: string;
    element: string;
    elementPath: string;
    timestamp: number;
    selectedText?: string;
    url?: string;
  };

  export type VisualTodoProps = {
    annotationStatuses?: Record<string, VisualTodoAnnotationStatus>;
    agent?: {
      provider: VisualTodoAgentProvider;
      model?: string;
      projectId?: string;
      endpoint?: string;
      headers?: Record<string, string>;
      autoDispatch?: boolean;
    };
    onAgentDispatch?: (payload: VisualTodoAgentDispatch) => void | Promise<void>;
    onAnnotationAdd?: (annotation: VisualTodoAnnotation) => void;
    onAnnotationDelete?: (annotation: VisualTodoAnnotation) => void;
    onAnnotationUpdate?: (annotation: VisualTodoAnnotation) => void;
    onAnnotationsClear?: (annotations: VisualTodoAnnotation[]) => void;
    onSubmit?: (output: string, annotations: VisualTodoAnnotation[]) => void;
    visibleControls?: {
      pause?: boolean;
      markers?: boolean;
      copy?: boolean;
      send?: boolean;
      clear?: boolean;
      settings?: boolean;
      inspector?: boolean;
      exit?: boolean;
    };
  };

  export const VisualTodo: ComponentType<VisualTodoProps>;
  export function loadAllAnnotations<T = VisualTodoAnnotation>(): Map<string, T[]>;
  export function saveAnnotations<T = VisualTodoAnnotation>(pathname: string, annotations: T[]): void;
}
