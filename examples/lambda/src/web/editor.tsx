/**
 * FR-EXM-111/122: the code editor. Monaco still loads from its own CDN (FR-EXM-152 allows it); if
 * that CDN is unreachable the console falls back to a plain textarea with the same contract, so the
 * demo never depends on a third party being up.
 */
import { useEffect, useRef, useState } from "react";

// `require` here is Monaco's AMD loader, not Node's, so the window is narrowed through `unknown`.
interface MonacoWindow {
  require?: { (deps: string[], cb: () => void): void; config(o: { paths: Record<string, string> }): void };
  monaco?: { editor: { create(el: HTMLElement, o: Record<string, unknown>): MonacoEditor } };
}
interface MonacoEditor {
  getValue(): string;
  setValue(v: string): void;
  dispose(): void;
}

const VS = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs";

export interface Editor {
  /** Where Monaco mounts, when Monaco is available. */
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** Where the fallback types, when it is not. */
  areaRef: React.RefObject<HTMLTextAreaElement | null>;
  monaco: boolean;
  getValue(): string;
  setValue(v: string): void;
}

/** Loads the default snippet, then Monaco. Returns the same read/write pair either way. */
export function useEditor(): Editor {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const editor = useRef<MonacoEditor | null>(null);
  const [monaco, setMonaco] = useState(false);

  useEffect(() => {
    let alive = true;
    const w = window as unknown as MonacoWindow;
    const start = async () => {
      const snippet = await fetch("/default-snippet").then((r) => (r.ok ? r.text() : "")).catch(() => "");
      if (!alive) return;
      if (snippet && areaRef.current && areaRef.current.value === "") areaRef.current.value = snippet;
      if (!w.require) return;
      w.require.config({ paths: { vs: VS } });
      w.require(["vs/editor/editor.main"], () => {
        if (!alive || !hostRef.current || !w.monaco) return;
        editor.current = w.monaco.editor.create(hostRef.current, {
          value: snippet || areaRef.current?.value || "",
          language: "javascript",
          theme: "vs-dark",
          minimap: { enabled: false },
          automaticLayout: true,
          fontSize: 13,
          scrollBeyondLastLine: false,
        });
        setMonaco(true);
      });
    };
    void start();
    return () => {
      alive = false;
      editor.current?.dispose();
      editor.current = null;
    };
  }, []);

  return {
    hostRef,
    areaRef,
    monaco,
    getValue: () => editor.current?.getValue() ?? areaRef.current?.value ?? "",
    setValue: (v: string) => {
      if (editor.current) editor.current.setValue(v);
      else if (areaRef.current) areaRef.current.value = v;
    },
  };
}
