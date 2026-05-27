/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Stateless React-PDF SVG icon components used by the PDF subsystem.
 *
 * Each component renders a small flat-line icon (callouts, attachments, file
 * type tiles, mentions, task checkmarks, etc.) and accepts `size` and `color`
 * props with sensible per-icon defaults. Used by `./node-renderers` when
 * rendering nodes that need iconography (callouts, attachments, embedded
 * references); icons are intentionally NOT re-exported from `./index.ts` —
 * they are internal to the PDF subsystem.
 *
 * `getFileIcon` dispatches a MIME / file-type string to the appropriate icon
 * component (`ImageIcon`, `VideoIcon`, `MusicIcon`, `FileTextIcon`,
 * `TableIcon`, `PresentationIcon`, `ArchiveIcon`) with the matching brand
 * accent color, falling back to `PaperclipIcon` for unknown types.
 */

import { Circle, Path, Rect, Svg } from "@react-pdf/renderer";

type IconProps = {
  size?: number;
  color?: string;
};

/**
 * Default callout glyph. Props: `size` (default 16) and `color` (default white).
 */
export const LightbulbIcon = ({ size = 16, color = "#ffffff" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M9 21h6M12 3a6 6 0 0 0-6 6c0 2.22 1.21 4.16 3 5.19V17a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.81c1.79-1.03 3-2.97 3-5.19a6 6 0 0 0-6-6z"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/**
 * Document/page glyph for page embeds and file links. Props: `size` (default 12)
 * and `color` (default brand blue `#1e40af`).
 */
export const DocumentIcon = ({ size = 12, color = "#1e40af" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path d="M14 2v6h6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M16 13H8M16 17H8M10 9H8" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/**
 * Chain-link glyph for hyperlinks and page references. Props: `size`
 * (default 12) and `color` (default brand blue `#2563eb`).
 */
export const LinkIcon = ({ size = 12, color = "#2563eb" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/**
 * Generic attachment glyph. Used as the `getFileIcon` fallback for unknown
 * MIME types. Props: `size` (default 16) and `color` (default gray `#374151`).
 */
export const PaperclipIcon = ({ size = 16, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/**
 * Image-attachment glyph. Selected by `getFileIcon` when the MIME prefix is
 * `image/`. Props: `size` (default 16) and `color` (default gray `#374151`).
 */
export const ImageIcon = ({ size = 16, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={3} y={3} width={18} height={18} rx={2} ry={2} fill="none" stroke={color} strokeWidth={2} />
    <Circle cx={8.5} cy={8.5} r={1.5} fill={color} />
    <Path d="M21 15l-5-5L5 21" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/**
 * Video-attachment glyph. Selected by `getFileIcon` when the MIME prefix is
 * `video/`. Props: `size` (default 16) and `color` (default gray `#374151`).
 */
export const VideoIcon = ({ size = 16, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={2} y={4} width={15} height={16} rx={2} ry={2} fill="none" stroke={color} strokeWidth={2} />
    <Path d="M17 10l5-3v10l-5-3z" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/**
 * Audio-attachment glyph. Selected by `getFileIcon` when the MIME prefix is
 * `audio/`. Props: `size` (default 16) and `color` (default gray `#374151`).
 */
export const MusicIcon = ({ size = 16, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M9 18V5l12-2v13" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Circle cx={6} cy={18} r={3} fill="none" stroke={color} strokeWidth={2} />
    <Circle cx={18} cy={16} r={3} fill="none" stroke={color} strokeWidth={2} />
  </Svg>
);

/**
 * Text-document glyph. Selected by `getFileIcon` for PDFs (rendered red) and
 * Word documents (rendered blue). Props: `size` (default 16) and `color`
 * (default gray `#374151`).
 */
export const FileTextIcon = ({ size = 16, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/**
 * Spreadsheet glyph. Selected by `getFileIcon` for Excel / spreadsheet MIME
 * types. Props: `size` (default 16) and `color` (default gray `#374151`).
 */
export const TableIcon = ({ size = 16, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={3} y={3} width={18} height={18} rx={2} fill="none" stroke={color} strokeWidth={2} />
    <Path d="M3 9h18M3 15h18M9 3v18M15 3v18" fill="none" stroke={color} strokeWidth={2} />
  </Svg>
);

/**
 * Slide-deck glyph. Selected by `getFileIcon` for PowerPoint / presentation
 * MIME types. Props: `size` (default 16) and `color` (default gray `#374151`).
 */
export const PresentationIcon = ({ size = 16, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={2} y={3} width={20} height={14} rx={2} fill="none" stroke={color} strokeWidth={2} />
    <Path d="M8 21l4-4 4 4M12 17v-4" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/**
 * Compressed-archive glyph. Selected by `getFileIcon` for zip / archive MIME
 * types. Props: `size` (default 16) and `color` (default gray `#374151`).
 */
export const ArchiveIcon = ({ size = 16, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M21 8v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Path
      d="M23 3H1v5h22V3zM10 12h4"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/**
 * Globe glyph for external rich embed cards. Props: `size` (default 12) and
 * `color` (default gray `#374151`).
 */
export const GlobeIcon = ({ size = 12, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={12} cy={12} r={10} fill="none" stroke={color} strokeWidth={2} />
    <Path
      d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
      fill="none"
      stroke={color}
      strokeWidth={2}
    />
  </Svg>
);

/**
 * Clipboard glyph for whiteboard embeds. Props: `size` (default 12) and
 * `color` (default gray `#6b7280`).
 */
export const ClipboardIcon = ({ size = 12, color = "#6b7280" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Rect x={8} y={2} width={8} height={4} rx={1} fill="none" stroke={color} strokeWidth={2} />
  </Svg>
);

/**
 * Document-with-lines glyph for diagram embeds. Props: `size` (default 12)
 * and `color` (default gray `#6b7280`).
 */
export const DiagramIcon = ({ size = 12, color = "#6b7280" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M14 3v4a1 1 0 0 0 1 1h4"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"
      fill="none"
      stroke={color}
      strokeWidth={2}
    />
    <Path d="M9 9h1M9 13h6M9 17h6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/**
 * Checkbox-with-check glyph for work-item / task references. Props: `size`
 * (default 14) and `color` (default gray `#374151`).
 */
export const TaskIcon = ({ size = 14, color = "#374151" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={3} y={3} width={18} height={18} rx={2} fill="none" stroke={color} strokeWidth={2} />
    <Path d="M9 12l2 2 4-4" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/**
 * White checkmark drawn inside the filled `taskCheckbox` view for checked task
 * list items. Props: `size` (default 10) and `color` (default white).
 */
export const CheckIcon = ({ size = 10, color = "#ffffff" }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M20 6L9 17l-5-5" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/**
 * Dispatches a MIME / file-type string to the matching icon component
 * (with the brand accent color for well-known formats). Order is significant:
 * MIME-prefix matches (`image/`, `video/`, `audio/`) run first, then substring
 * checks for `pdf`, `spreadsheet`/`excel`, `document`/`word`,
 * `presentation`/`powerpoint`, and `zip`/`archive`. Unknown types fall back to
 * `PaperclipIcon`.
 *
 * @param fileType - MIME string (e.g., `"image/png"`, `"application/pdf"`) or
 *                   a file-type label that contains one of the recognized
 *                   substrings.
 * @param size     - Icon size in PDF user-space units. Defaults to 16.
 * @param color    - Fallback icon color for unrecognized formats. Defaults to
 *                   `"#374151"`. Recognized formats (`pdf`, spreadsheet, etc.)
 *                   override this with their brand accent.
 */
export const getFileIcon = (fileType: string, size = 16, color = "#374151") => {
  if (fileType.startsWith("image/")) return <ImageIcon size={size} color={color} />;
  if (fileType.startsWith("video/")) return <VideoIcon size={size} color={color} />;
  if (fileType.startsWith("audio/")) return <MusicIcon size={size} color={color} />;
  if (fileType.includes("pdf")) return <FileTextIcon size={size} color="#dc2626" />;
  if (fileType.includes("spreadsheet") || fileType.includes("excel")) return <TableIcon size={size} color="#16a34a" />;
  if (fileType.includes("document") || fileType.includes("word")) return <FileTextIcon size={size} color="#2563eb" />;
  if (fileType.includes("presentation") || fileType.includes("powerpoint"))
    return <PresentationIcon size={size} color="#ea580c" />;
  if (fileType.includes("zip") || fileType.includes("archive")) return <ArchiveIcon size={size} color={color} />;
  return <PaperclipIcon size={size} color={color} />;
};
