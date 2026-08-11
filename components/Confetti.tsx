'use client';

import { useEffect, useRef } from 'react';

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  colour: string;
  life: number;
}

/**
 * Canvas confetti for the winner.
 *
 * Canvas rather than DOM nodes because two hundred absolutely positioned
 * elements on an ageing club laptop drops the frame rate at the exact moment
 * everyone is looking at the screen. Runs once per win, then frees the loop.
 */
export function Confetti({
  fire,
  highlight,
  calm,
}: {
  fire: number;
  highlight: string;
  calm: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!fire) return;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm || reduce) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const colours = [highlight, '#ffb020', '#26c6a6', '#4c8dff', '#ffffff', '#b7e43b'];
    const pieces: Piece[] = Array.from({ length: 220 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.5,
      y: h * 0.42 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 13,
      vy: -6 - Math.random() * 12,
      size: 5 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.34,
      colour: colours[Math.floor(Math.random() * colours.length)],
      life: 1,
    }));

    let alive = true;
    const step = () => {
      if (!alive) return;
      ctx.clearRect(0, 0, w, h);
      let remaining = 0;

      for (const p of pieces) {
        p.vy += 0.36; // gravity
        p.vx *= 0.995; // drag
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.006;

        if (p.life <= 0 || p.y > h + 40) continue;
        remaining++;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.colour;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }

      if (remaining > 0) rafRef.current = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, w, h);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      ctx.clearRect(0, 0, w, h);
    };
  }, [fire, highlight, calm]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[90]"
    />
  );
}
