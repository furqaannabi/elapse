/**
 * `ChartStrip` — the strip-chart recorder that gives the meter its world.
 *
 * Paper scrolls left at a constant speed. While a session is running the
 * pen is down and draws a trace at the rate level; the area under the
 * trace is the money. When the session stops the pen lifts and the paper
 * keeps moving, blank. Sessions are passed as `[start, end]` epoch-ms
 * pairs (an open session has `end: null`), so the strip shows history:
 * a cancel leaves a visible gap, a restart puts the pen back down.
 *
 * Canvas 2D, DPR-aware, paused when offscreen or the tab is hidden.
 * With reduced motion the strip still renders but does not scroll.
 *
 * @param sessions - Running spans in epoch ms, oldest first.
 * @param pxPerSecond - Paper speed. Default 40 (one major cell per second).
 * @param height - Strip height in CSS px. Default 168.
 * @param level - 0..1 fraction of height at which the pen draws. Default 0.62.
 */
"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type Session = { start: number; end: number | null };

export type ChartStripProps = {
  sessions: Session[];
  pxPerSecond?: number;
  height?: number;
  level?: number;
  className?: string;
};

type Palette = {
  paper: string;
  grid: string;
  gridMajor: string;
  pen: string;
  penSoft: string;
  ink: string;
  inkSoft: string;
};

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    paper: v("--paper"),
    grid: v("--grid"),
    gridMajor: v("--grid-major"),
    pen: v("--pen"),
    penSoft: v("--pen-soft"),
    ink: v("--ink"),
    inkSoft: v("--ink-soft"),
  };
}

export function ChartStrip({
  sessions,
  pxPerSecond = 40,
  height = 168,
  level = 0.62,
  className,
}: ChartStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    let onscreen = true;
    let palette = readPalette(canvas);
    let width = 0;
    let dpr = 1;
    // Pen-head lift/drop is eased over LIFT_MS from the moment the state flips.
    const LIFT_MS = 220;
    let prevPenDown = false;
    let penChangedAt = 0;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const now = Date.now();
      const penX = Math.round(width - 56);
      const baseY = Math.round(height - 24) + 0.5;
      const penY = Math.round(height * (1 - level)) + 0.5;
      const msPerPx = 1000 / pxPerSecond;
      const scroll = reduced ? 0 : (now / msPerPx) % 40;

      ctx.clearRect(0, 0, width, height);

      // Ruling: a faint vertical line per second only. No minor grid, no
      // horizontal rules: the strip is a tape, not graph paper.
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = palette.gridMajor;
      for (let x = -scroll; x <= width + 40; x += 40) {
        const px = Math.round(x) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Baseline with a tick every second and a clock label every five.
      ctx.strokeStyle = palette.inkSoft;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      ctx.lineTo(penX, baseY);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.inkSoft;
      ctx.font = `500 10px ${getComputedStyle(canvas).getPropertyValue("--font-martian") || "monospace"}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let x = -scroll; x <= penX; x += 40) {
        const px = Math.round(x) + 0.5;
        if (px < 0) continue;
        const sec = Math.round((now - (penX - px) * (1000 / pxPerSecond)) / 1000);
        ctx.strokeStyle = palette.inkSoft;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(px, baseY);
        ctx.lineTo(px, baseY + (sec % 5 === 0 ? 6 : 3));
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (sec % 5 === 0 && px > 14 && px < penX - 14) {
          ctx.fillText(`:${String(sec % 60).padStart(2, "0")}`, px, baseY + 8);
        }
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";

      // Trace: for each session, map time → x and draw pen-down segments.
      const timeAt = (x: number) => now - (penX - x) * msPerPx;
      const xAt = (t: number) => penX - (now - t) / msPerPx;
      const list = sessionsRef.current;
      let penDown = false;

      for (const s of list) {
        const end = s.end ?? now;
        if (end < timeAt(0) || s.start > now) continue;
        const x0 = Math.max(0, xAt(s.start));
        const x1 = Math.min(penX, xAt(end));
        if (x1 <= x0) continue;
        if (s.end === null) penDown = true;

        // Area under the trace — the money.
        ctx.fillStyle = palette.penSoft;
        ctx.fillRect(x0, penY, x1 - x0, baseY - penY);

        // Pen-down and pen-up verticals plus the level line.
        ctx.strokeStyle = palette.pen;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        if (xAt(s.start) >= 0) {
          ctx.moveTo(x0, baseY);
          ctx.lineTo(x0, penY);
        } else {
          ctx.moveTo(x0, penY);
        }
        ctx.lineTo(x1, penY);
        if (s.end !== null && xAt(end) <= penX) ctx.lineTo(x1, baseY);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // Pen head: a red marker at the writing edge; lifts when idle,
      // eased so the lift reads as a gesture rather than a cut.
      if (penDown !== prevPenDown) {
        prevPenDown = penDown;
        penChangedAt = now;
      }
      const lift = reduced ? 1 : easeOut(Math.min(1, (now - penChangedAt) / LIFT_MS));
      const from = penDown ? penY - 14 : penY;
      const to = penDown ? penY : penY - 14;
      const headY = from + (to - from) * lift;
      ctx.strokeStyle = palette.inkSoft;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(penX + 0.5, 0);
      ctx.lineTo(penX + 0.5, height);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = penDown ? palette.pen : palette.inkSoft;
      ctx.beginPath();
      ctx.moveTo(penX, headY);
      ctx.lineTo(penX + 10, headY - 6);
      ctx.lineTo(penX + 10, headY + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(penX + 10, headY - 3, 26, 6);

      // Placards, top corners so they never share the baseline with the clock.
      const cs = getComputedStyle(canvas);
      ctx.fillStyle = palette.inkSoft;
      ctx.font = `600 10px ${cs.getPropertyValue("--font-archivo") || "sans-serif"}`;
      ctx.textBaseline = "top";
      ctx.letterSpacing = "0.1em";
      ctx.fillText("1 CELL · 1 S", 8, 8);
      ctx.textAlign = "right";
      ctx.fillText(penDown ? "PEN DOWN" : "PEN UP", width - 8, 8);
      ctx.textAlign = "left";
      ctx.letterSpacing = "0px";
      ctx.textBaseline = "alphabetic";
    };

    const loop = () => {
      draw();
      if (!reduced && visible && onscreen) raf = requestAnimationFrame(loop);
    };
    const restart = () => {
      cancelAnimationFrame(raf);
      loop();
    };

    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting;
      if (onscreen) restart();
    });
    io.observe(canvas);
    const onVis = () => {
      visible = document.visibilityState === "visible";
      if (visible) restart();
    };
    document.addEventListener("visibilitychange", onVis);
    const mo = new MutationObserver(() => {
      palette = readPalette(canvas);
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    resize();
    restart();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pxPerSecond, height, level]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("block w-full", className)}
      style={{ height }}
      role="img"
      aria-label="Chart strip: the pen draws while the meter runs and lifts when it stops"
    />
  );
}
