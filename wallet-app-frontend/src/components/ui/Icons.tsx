/**
 * Inline SVG icon set — ~24 hand-rolled glyphs instead of an icon dependency,
 * which keeps the bundle small and the stroke weight consistent.
 */

import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconArrowLeft = (p: IconProps) => (
  <Base {...p}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Base>
);

export const IconArrowRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M4.5 12h15" />
    <path d="m13 5.5 6.5 6.5-6.5 6.5" />
  </Base>
);

export const IconChevronRight = (p: IconProps) => (
  <Base {...p}>
    <path d="m9 18 6-6-6-6" />
  </Base>
);

export const IconChevronDown = (p: IconProps) => (
  <Base {...p}>
    <path d="m6 9 6 6 6-6" />
  </Base>
);

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Base>
);

export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Base>
);

export const IconSent = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </Base>
);

export const IconReceived = (p: IconProps) => (
  <Base {...p}>
    <path d="M17 7 7 17" />
    <path d="M16 17H7V8" />
  </Base>
);

export const IconScan = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
    <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
    <path d="M21 16v2.5A2.5 2.5 0 0 1 18.5 21H16" />
    <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
    <path d="M3 12h18" />
  </Base>
);

export const IconQr = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 14h3v3h-3z" />
    <path d="M20 14v.01M20 17.5v.01M14 20.5v.01M17.5 20.5v.01M20.5 20v.5" />
  </Base>
);

export const IconHome = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9.8V19a1.5 1.5 0 0 0 1.5 1.5h10A1.5 1.5 0 0 0 18.5 19V9.8" />
    <path d="M10 20.5v-5h4v5" />
  </Base>
);

export const IconReceipt = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 2.5h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-3-2v-16a1 1 0 0 1 1-1Z" />
    <path d="M9 7.5h6M9 11.5h6" />
  </Base>
);

export const IconUser = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </Base>
);

export const IconWallet = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="5.5" width="19" height="14" rx="3" />
    <path d="M2.5 10h19" />
    <circle cx="16.5" cy="14.75" r="1.25" />
  </Base>
);

export const IconCopy = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="9" width="11.5" height="11.5" rx="2.5" />
    <path d="M5.5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5v1" />
  </Base>
);

export const IconShare = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3v12" />
    <path d="m8 6.5 4-3.5 4 3.5" />
    <path d="M5 13.5v5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-5" />
  </Base>
);

export const IconDownload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3.5v11" />
    <path d="m8 11 4 4 4-4" />
    <path d="M4.5 20.5h15" />
  </Base>
);

export const IconTorch = (p: IconProps) => (
  <Base {...p}>
    <path d="M13 2.5 4.5 13.5H10l-1 8 8.5-11H12l1-8Z" />
  </Base>
);

export const IconRefresh = (p: IconProps) => (
  <Base {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4" />
    <path d="M20.5 4v5h-5" />
  </Base>
);

export const IconEye = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const IconEyeOff = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2" />
    <path d="M6.7 6.8C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.1-.5 4.3-1.2" />
    <path d="M12 5.5c6 0 9.5 6.5 9.5 6.5s-.7 1.4-2 2.7" />
  </Base>
);

export const IconLock = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2.5" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </Base>
);

export const IconWarning = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3.5 2.5 20h19L12 3.5Z" />
    <path d="M12 9.5v4.5M12 17.2v.01" />
  </Base>
);

export const IconInfo = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.01" />
  </Base>
);

export const IconTrash = (p: IconProps) => (
  <Base {...p}>
    <path d="M4.5 6.5h15" />
    <path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.6 20a1.4 1.4 0 0 0 1.4 1.3h6a1.4 1.4 0 0 0 1.4-1.3l1.1-13.5" />
    <path d="M10.5 10.5v6.5M13.5 10.5v6.5" />
  </Base>
);

export const IconPhone = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 2.5h2.6l1.9 4.6-2.1 1.3a12.5 12.5 0 0 0 6.2 6.2l1.3-2.1 4.6 1.9V17a2.5 2.5 0 0 1-2.5 2.5A15.5 15.5 0 0 1 2.5 5 2.5 2.5 0 0 1 5 2.5Z" />
  </Base>
);

export const IconBackspace = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 5.5H9L3.2 12 9 18.5h11a1 1 0 0 0 1-1v-11a1 1 0 0 0-1-1Z" />
    <path d="m11.5 9.5 4.5 5M16 9.5l-4.5 5" />
  </Base>
);

export const IconLogout = (p: IconProps) => (
  <Base {...p}>
    <path d="M15 3.5h3A2.5 2.5 0 0 1 20.5 6v12a2.5 2.5 0 0 1-2.5 2.5h-3" />
    <path d="m10 16.5-4.5-4.5L10 7.5" />
    <path d="M5.5 12h9" />
  </Base>
);

export const IconClock = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 2" />
  </Base>
);

export const IconNote = (p: IconProps) => (
  <Base {...p}>
    <path d="M4.5 3.5h15v11l-5 5h-10v-16Z" />
    <path d="M14.5 19.5v-5h5" />
  </Base>
);

export const IconSound = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18.5 6.5a8 8 0 0 1 0 11" />
  </Base>
);

export const IconBell = (p: IconProps) => (
  <Base {...p}>
    <path d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15L18 15.5Z" />
    <path d="M9.8 21a2.4 2.4 0 0 0 4.4 0" />
  </Base>
);

export const IconSpark = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6L4.5 10.8 10.2 9 12 3.5Z" />
    <path d="M18.5 3v3M20 4.5h-3" />
  </Base>
);
