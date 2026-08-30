import Image from 'next/image';

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

export const CLUB_NAME = 'Newcomb & District Cricket Club';

export const CLUB_LOGO = {
  src: `${BASE_PATH}/brand/20260403-NDCC-Logo-Bg-Removed-Rev00.png`,
  width: 1184,
  height: 896,
  alt: `${CLUB_NAME} crest`,
} as const;

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
 * The approved club crest and optional text lock-up.
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
