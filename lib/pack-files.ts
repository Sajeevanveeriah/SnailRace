'use client';

/**
 * The session's verified pack media.
 *
 * Browser storage cannot hold video files, so verified File handles live in
 * memory for the life of the page: the operator attaches the pack's media,
 * each file is hashed and matched against the locked manifest, and only then
 * does it become playable. A reload empties this store - which is why the
 * media health check in preflight re-verifies before doors open, and why a
 * race whose file is missing says so instead of guessing.
 */

const files = new Map<string, { file: File; url: string }>();
const listeners = new Set<() => void>();

export function putPackFile(mediaSha256: string, file: File): void {
  const old = files.get(mediaSha256);
  if (old) URL.revokeObjectURL(old.url);
  files.set(mediaSha256, { file, url: URL.createObjectURL(file) });
  listeners.forEach((l) => l());
}

export const getPackFileUrl = (mediaSha256: string): string | null =>
  files.get(mediaSha256)?.url ?? null;

export const hasPackFile = (mediaSha256: string): boolean => files.has(mediaSha256);

export const verifiedPackHashes = (): string[] => [...files.keys()];

export function clearPackFiles(): void {
  for (const { url } of files.values()) URL.revokeObjectURL(url);
  files.clear();
  listeners.forEach((l) => l());
}

/** Subscribe to attachment changes, for React surfaces. */
export function onPackFilesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
