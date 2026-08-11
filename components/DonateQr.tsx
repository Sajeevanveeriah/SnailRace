'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The QR is how a punter's phone learns which snails are in this race.
 *
 * The line-up is encoded into the URL the code points at, so the stage needs
 * no database and no socket to tell twelve phones what to show. Regenerating
 * the code between races is what keeps donations attached to the right race.
 *
 * `qrcode` is imported lazily: it is only needed once the stage is idle, and
 * keeping it out of the first paint matters more on the projector laptop than
 * anywhere else in the app.
 */
export function DonateQr({ url, size = 190 }: { url: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { toCanvas } = await import('qrcode');
        if (cancelled || !canvasRef.current) return;
        await toCanvas(canvasRef.current, url, {
          width: size,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0b0b0f', light: '#ffffff' },
        });
        if (!cancelled) setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl bg-white p-3 shadow-lg">
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          role="img"
          aria-label="QR code linking to the donation page for this race"
        />
      </div>
      {failed ? (
        <p className="max-w-[220px] break-all text-center text-[11px] text-white/60">{url}</p>
      ) : (
        <p className="text-center text-[11px] uppercase tracking-[0.22em] text-white/45">
          Scan to back a snail
        </p>
      )}
    </div>
  );
}
