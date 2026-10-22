import { nameWords } from './names';

/**
 * A snail's name set so it only ever wraps at a space. A hyphenated word is
 * one unbreakable piece, so "Sir Slimes-a-Lot of Newcomb" never ends a line
 * at "Slimes-a-". The text itself is unchanged for screen readers and tests.
 */
export function NameText({ name }: { name: string }) {
  const words = nameWords(name);
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 ? ' ' : ''}
          {w.nobreak ? <span className="ss-nb">{w.text}</span> : w.text}
        </span>
      ))}
    </>
  );
}
