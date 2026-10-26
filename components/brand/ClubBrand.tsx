import Image from 'next/image';

import { CLUB, clubImage } from '@/lib/club';

export const CLUB_NAME = CLUB.name;

/** The club's crest, from its profile (`clubs/<id>/club.ts`). */
export const CLUB_LOGO = { ...clubImage(CLUB.crest), alt: `${CLUB_NAME} crest` } as const;

export interface ClubBrandProps {
  className?: string;
  imageClassName?: string;
  nameClassName?: string;
  /** Include the full club name beside the crest. */
  showName?: boolean;
  /** Eagerly load the crest when it is part of the initial projector frame. */
  priority?: boolean;
}

const classNames = (...values: Array<string | undefined | false>): string =>
  values.filter(Boolean).join(' ');

/**
 * The club crest and optional text lock-up.
 *
 * The public URL includes Next's configured base path, so the same component
 * works on a server deployment and the `/SnailRace` GitHub Pages export.
 */
export function ClubBrand({
  className,
  imageClassName,
  nameClassName,
  showName = true,
  priority = false,
}: ClubBrandProps) {
  return (
    <span className={classNames('inline-flex min-w-0 items-center gap-3', className)}>
      <Image
        unoptimized
        src={CLUB_LOGO.src}
        width={CLUB_LOGO.width}
        height={CLUB_LOGO.height}
        alt={showName ? '' : CLUB_LOGO.alt}
        priority={priority}
        sizes="(max-width: 640px) 56px, 80px"
        className={classNames('h-auto w-14 shrink-0 object-contain sm:w-20', imageClassName)}
      />
      {showName ? (
        <span
          className={classNames(
            'min-w-0 text-sm font-extrabold uppercase leading-tight tracking-[0.12em]',
            nameClassName,
          )}
        >
          {CLUB_NAME}
        </span>
      ) : null}
    </span>
  );
}
