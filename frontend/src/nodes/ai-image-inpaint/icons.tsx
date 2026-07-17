import React from 'react';

interface InpaintIconProps {
  className?: string;
}

function createIcon(path: React.ReactNode): React.FC<InpaintIconProps> {
  const Icon: React.FC<InpaintIconProps> = ({ className }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );

  return Icon;
}

export const InpaintBrushIcon = createIcon(
  <>
    <path d="m9.1 20.3 10.8-10.8a2.6 2.6 0 0 0-3.7-3.7L5.4 16.6" />
    <path d="M4 20c2.2.4 4-.1 5.1-1.3 1-1 1.4-2.6.4-3.6-1-1-2.6-.6-3.6.4C4.7 16.7 3.9 18.2 4 20Z" />
  </>,
);

export const InpaintEraserIcon = createIcon(
  <>
    <path d="m7 21-4-4a2.8 2.8 0 0 1 0-4l8.8-8.8a2.8 2.8 0 0 1 4 0l5.1 5.1a2.8 2.8 0 0 1 0 4L13.2 21" />
    <path d="M6.2 10.8 13.2 18" />
    <path d="M7 21h14" />
  </>,
);

export const InpaintTrashIcon = createIcon(
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="m19 6-1 15H6L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </>,
);

export const InpaintXIcon = createIcon(
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);
