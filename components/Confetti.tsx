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

    /* A tasteful fall from the top of the frame in the club colours and the
       winner's own, sized to the screen so 4K looks like 720p. */
    const scale = Math.max(0.6, Math.min(w / 1280, h / 720));
    const colours = [highlight, highlight, '#e8b55e', '#b3141c', '#fff9ed', '#81c3c1'];
    const pieces: Piece[] = Array.from({ length: 150 }, () => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 2.4 * scale,
      vy: (1.6 + Math.random() * 2.6) * scale,
      size: (6 + Math.random() * 7) * scale,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      colour: colours[Math.floor(Math.random() * colours.length)],
      life: 1,
    }));

    let alive = true;
    const step = () => {
      if (!alive) return;
      ctx.clearRect(0, 0, w, h);
      let remaining = 0;

      for (const p of pieces) {
        p.vy += 0.02 * scale; // a gentle fall
        p.vx += Math.sin(p.rot) * 0.04 * scale; // flutter
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.004;

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
      className="pointer-events-none fixed inset-0 z-[3]"
    />
  );
}
