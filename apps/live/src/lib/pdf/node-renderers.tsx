/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Recursive document-tree renderer for the PDF subsystem.
 *
 * Maps TipTap node `type` names to React-PDF primitives via the `nodeRenderers`
 * registry. The exported `renderNode` traversal walks the document depth-first,
 * threading an internal context (parent type, list nesting level, list-item
 * index, inherited `textAlign`, and a per-render `KeyGenerator`) so each
 * renderer can reproduce the layout the TipTap editor would show on screen.
 *
 * Supported node types include: `doc`, `paragraph`, `heading` (levels 1-6),
 * `blockquote`, `codeBlock`, `bulletList`, `orderedList`, `listItem`,
 * `taskList`, `taskItem`, `table`, `tableRow`, `tableHeader`, `tableCell`,
 * `horizontalRule`, `hardBreak`, `image`, `imageComponent`, `calloutComponent`,
 * and `mention`. Unknown types fall through to a generic children-only `View`.
 *
 * Pulls in shared styles from `./styles`, inline-mark application from
 * `./mark-renderers`, color resolution from `./colors`, and icon components
 * from `./icons`. Consumed by `./plane-pdf-exporter` which wraps the rendered
 * children in a React-PDF `Document` / `Page` shell.
 */

import { Image, Link, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { ReactElement } from "react";
import { CORE_EXTENSIONS } from "@plane/editor";
import { BACKGROUND_COLORS, EDITOR_BACKGROUND_COLORS, resolveColorForPdf, TEXT_COLORS } from "./colors";
import { CheckIcon, ClipboardIcon, DocumentIcon, GlobeIcon, LightbulbIcon, LinkIcon } from "./icons";
import { applyMarks } from "./mark-renderers";
import { pdfStyles } from "./styles";
import type { KeyGenerator, NodeRendererRegistry, PDFExportMetadata, PDFRenderContext, TipTapNode } from "./types";

/**
 * Resolves the icon element shown inside a callout node from the node's
 * `data-logo-in-use` / `data-icon-name` / `data-emoji-unicode` attrs.
 * Falls back to a generic lightbulb when neither an emoji nor a known
 * icon name is provided.
 */
const getCalloutIcon = (node: TipTapNode, color: string): ReactElement => {
  const logoInUse = node.attrs?.["data-logo-in-use"] as string | undefined;
  const iconName = node.attrs?.["data-icon-name"] as string | undefined;
  const iconColor = (node.attrs?.["data-icon-color"] as string) || color;

  if (logoInUse === "emoji") {
    const emojiUnicode = node.attrs?.["data-emoji-unicode"] as string | undefined;
    if (emojiUnicode) {
      return <Text style={{ fontSize: 14 }}>{emojiUnicode}</Text>;
    }
  }

  if (iconName) {
    switch (iconName) {
      case "FileText":
      case "File":
        return <DocumentIcon size={16} color={iconColor} />;
      case "Link":
        return <LinkIcon size={16} color={iconColor} />;
      case "Globe":
        return <GlobeIcon size={16} color={iconColor} />;
      case "Clipboard":
        return <ClipboardIcon size={16} color={iconColor} />;
      case "CheckSquare":
      case "Check":
        return <CheckIcon size={16} color={iconColor} />;
      case "Lightbulb":
      default:
        return <LightbulbIcon size={16} color={iconColor} />;
    }
  }

  return <LightbulbIcon size={16} color={color} />;
};

/**
 * Returns a fresh `KeyGenerator` that yields monotonically unique string keys
 * (`node-0`, `node-1`, …) per call. Each `renderPlaneDocToPdf*` invocation
 * builds its own generator so React keys are stable within one render pass
 * and disjoint across documents — preventing key collisions when multiple
 * documents are rendered in the same Node process.
 */
export const createKeyGenerator = (): KeyGenerator => {
  let counter = 0;
  return () => `node-${counter++}`;
};

/**
 * Renders a TipTap text node, folding its `marks` into a single React-PDF
 * `Style` and emitting either a `<Link>` (when a `link` mark is present) or a
 * plain `<Text>` element.
 */
const renderTextWithMarks = (node: TipTapNode, getKey: KeyGenerator): ReactElement => {
  const style = applyMarks(node.marks, {});
  const hasLink = node.marks?.find((m) => m.type === "link");

  if (hasLink) {
    const href = (hasLink.attrs?.href as string) || "#";
    return (
      <Link key={getKey()} src={href} style={{ ...pdfStyles.link, ...style }}>
        {node.text || ""}
      </Link>
    );
  }

  return (
    <Text key={getKey()} style={style}>
      {node.text || ""}
    </Text>
  );
};

/** Returns a React-PDF style with `textAlign` set, used for paragraph / heading text alignment. */
const getTextAlignStyle = (textAlign: string | null | undefined): Style => {
  if (!textAlign) return {};
  return {
    textAlign: textAlign as "left" | "right" | "center" | "justify",
  };
};

/** Returns a React-PDF flexbox style that aligns container children to match the node's textAlign attr. */
const getFlexAlignStyle = (textAlign: string | null | undefined): Style => {
  if (!textAlign) return {};
  if (textAlign === "right") return { alignItems: "flex-end" };
  if (textAlign === "center") return { alignItems: "center" };
  return {};
};

/**
 * Registry mapping TipTap node `type` names to renderer functions. Each
 * renderer receives `(node, alreadyRenderedChildren, ctx)` and returns a
 * React-PDF element keyed via `ctx.getKey()`. Registry entries can be
 * overridden by reassigning a key, but the live PDF pipeline does not do so
 * in production — additions are made by extending the registry inline.
 *
 * Notable behaviors:
 *  - `paragraph`/`heading` honor a `textAlign` attr and an optional
 *    `backgroundColor` resolved through `./colors`.
 *  - `bulletList`/`orderedList` apply nesting indent only when nested under a
 *    `listItem` (signalled via the internal `_nestingLevel` context attr).
 *  - `listItem` chooses `•` vs. a numeric bullet from `_parentType` /
 *    `_listItemIndex`.
 *  - `taskItem` renders a checkbox `View` and a check icon when `checked`.
 *  - `tableRow` switches header vs. body row style from the internal
 *    `_isHeader` attr injected during traversal.
 *  - `image` renders a `<View>` placeholder when `ctx.metadata.noAssets` is
 *    true, otherwise an `<Image>` sized from the node's `width` attr.
 *  - `imageComponent` resolves an asset id against
 *    `ctx.metadata.resolvedImageUrls` and renders a placeholder card when no
 *    resolved URL is available (so the PDF still renders something visible).
 *  - `mention` displays the resolved user `display_name` when
 *    `entity_name === "user_mention"` / `"user"`, falling back to the raw
 *    `id` / `entity_identifier`.
 */
export const nodeRenderers: NodeRendererRegistry = {
  doc: (_node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => (
    <View key={ctx.getKey()}>{children}</View>
  ),

  text: (node: TipTapNode, _children: ReactElement[], ctx: PDFRenderContext): ReactElement =>
    renderTextWithMarks(node, ctx.getKey),

  paragraph: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const textAlign = node.attrs?.textAlign as string | null;
    const background = node.attrs?.backgroundColor as string | undefined;
    const alignStyle = getTextAlignStyle(textAlign);
    const flexStyle = getFlexAlignStyle(textAlign);
    const resolvedBgColor =
      background && background !== "default" ? resolveColorForPdf(background, "background") : null;
    const bgStyle = resolvedBgColor ? { backgroundColor: resolvedBgColor } : {};

    return (
      <View key={ctx.getKey()} style={[pdfStyles.paragraphWrapper, flexStyle, bgStyle]}>
        <Text style={[pdfStyles.paragraph, alignStyle, bgStyle]}>{children}</Text>
      </View>
    );
  },

  heading: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const level = (node.attrs?.level as number) || 1;
    const styleKey = `heading${level}` as keyof typeof pdfStyles;
    const style = pdfStyles[styleKey] || pdfStyles.heading1;
    const textAlign = node.attrs?.textAlign as string | null;
    const alignStyle = getTextAlignStyle(textAlign);
    const flexStyle = getFlexAlignStyle(textAlign);

    return (
      <View key={ctx.getKey()} style={flexStyle}>
        <Text style={[style, alignStyle]}>{children}</Text>
      </View>
    );
  },

  blockquote: (_node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => (
    <View key={ctx.getKey()} style={pdfStyles.blockquote} wrap={false}>
      {children}
    </View>
  ),

  codeBlock: (node: TipTapNode, _children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const codeContent = node.content?.map((c) => c.text || "").join("") || "";
    return (
      <View key={ctx.getKey()} style={pdfStyles.codeBlock} wrap={false}>
        <Text>{codeContent}</Text>
      </View>
    );
  },

  bulletList: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const nestingLevel = (node.attrs?._nestingLevel as number) || 0;
    const indentStyle = nestingLevel > 0 ? { marginLeft: 18 } : {};
    return (
      <View key={ctx.getKey()} style={[pdfStyles.bulletList, indentStyle]}>
        {children}
      </View>
    );
  },

  orderedList: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const nestingLevel = (node.attrs?._nestingLevel as number) || 0;
    const indentStyle = nestingLevel > 0 ? { marginLeft: 18 } : {};
    return (
      <View key={ctx.getKey()} style={[pdfStyles.orderedList, indentStyle]}>
        {children}
      </View>
    );
  },

  listItem: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const isOrdered = node.attrs?._parentType === "orderedList";
    const index = (node.attrs?._listItemIndex as number) || 0;

    const bullet = isOrdered ? `${index}.` : "•";

    const textAlign = node.attrs?._textAlign as string | null;
    const flexStyle = getFlexAlignStyle(textAlign);

    return (
      <View key={ctx.getKey()} style={[pdfStyles.listItem, flexStyle]} wrap={false}>
        <View style={pdfStyles.listItemBullet}>
          <Text>{bullet}</Text>
        </View>
        <View style={pdfStyles.listItemContent}>{children}</View>
      </View>
    );
  },

  taskList: (_node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => (
    <View key={ctx.getKey()} style={pdfStyles.taskList}>
      {children}
    </View>
  ),

  taskItem: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const checked = node.attrs?.checked === true;
    return (
      <View key={ctx.getKey()} style={pdfStyles.taskItem} wrap={false}>
        <View style={checked ? [pdfStyles.taskCheckbox, pdfStyles.taskCheckboxChecked] : pdfStyles.taskCheckbox}>
          {checked && <CheckIcon size={8} color="#ffffff" />}
        </View>
        <View style={pdfStyles.listItemContent}>{children}</View>
      </View>
    );
  },

  table: (_node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => (
    <View key={ctx.getKey()} style={pdfStyles.table}>
      {children}
    </View>
  ),

  tableRow: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const isHeader = node.attrs?._isHeader === true;
    return (
      <View key={ctx.getKey()} style={isHeader ? pdfStyles.tableHeaderRow : pdfStyles.tableRow} wrap={false}>
        {children}
      </View>
    );
  },

  tableHeader: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const colwidth = node.attrs?.colwidth as number[] | undefined;
    const background = node.attrs?.background as string | undefined;
    const width = colwidth?.[0];
    const widthStyle = width ? { width, flex: undefined } : {};
    const resolvedBgColor = background ? resolveColorForPdf(background, "background") : null;
    const bgStyle = resolvedBgColor ? { backgroundColor: resolvedBgColor } : {};

    return (
      <View key={ctx.getKey()} style={[pdfStyles.tableHeaderCell, widthStyle, bgStyle]}>
        {children}
      </View>
    );
  },

  tableCell: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const colwidth = node.attrs?.colwidth as number[] | undefined;
    const background = node.attrs?.background as string | undefined;
    const width = colwidth?.[0];
    const widthStyle = width ? { width, flex: undefined } : {};
    const resolvedBgColor = background ? resolveColorForPdf(background, "background") : null;
    const bgStyle = resolvedBgColor ? { backgroundColor: resolvedBgColor } : {};

    return (
      <View key={ctx.getKey()} style={[pdfStyles.tableCell, widthStyle, bgStyle]}>
        {children}
      </View>
    );
  },

  horizontalRule: (_node: TipTapNode, _children: ReactElement[], ctx: PDFRenderContext): ReactElement => (
    <View key={ctx.getKey()} style={pdfStyles.horizontalRule} />
  ),

  hardBreak: (_node: TipTapNode, _children: ReactElement[], ctx: PDFRenderContext): ReactElement => (
    <Text key={ctx.getKey()}>{"\n"}</Text>
  ),

  image: (node: TipTapNode, _children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    if (ctx.metadata?.noAssets) {
      return <View key={ctx.getKey()} />;
    }

    const src = (node.attrs?.src as string) || "";
    const width = node.attrs?.width as number | undefined;
    const alignment = (node.attrs?.alignment as string) || "left";

    if (!src) {
      return <View key={ctx.getKey()} />;
    }

    const alignmentStyle =
      alignment === "center"
        ? { alignItems: "center" as const }
        : alignment === "right"
          ? { alignItems: "flex-end" as const }
          : { alignItems: "flex-start" as const };

    return (
      <View key={ctx.getKey()} style={[{ width: "100%" }, alignmentStyle]}>
        <Image
          src={src}
          style={[pdfStyles.image, width ? { width, maxHeight: 500 } : { maxWidth: 400, maxHeight: 500 }]}
        />
      </View>
    );
  },

  imageComponent: (node: TipTapNode, _children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    if (ctx.metadata?.noAssets) {
      return <View key={ctx.getKey()} />;
    }

    const assetId = (node.attrs?.src as string) || "";
    const rawWidth = node.attrs?.width;
    const width = typeof rawWidth === "string" ? parseInt(rawWidth, 10) : (rawWidth as number | undefined);
    const alignment = (node.attrs?.alignment as string) || "left";

    if (!assetId) {
      return <View key={ctx.getKey()} />;
    }

    let resolvedSrc = assetId;
    if (ctx.metadata?.resolvedImageUrls && ctx.metadata.resolvedImageUrls[assetId]) {
      resolvedSrc = ctx.metadata.resolvedImageUrls[assetId];
    }

    const alignmentStyle =
      alignment === "center"
        ? { alignItems: "center" as const }
        : alignment === "right"
          ? { alignItems: "flex-end" as const }
          : { alignItems: "flex-start" as const };

    if (!resolvedSrc.startsWith("http") && !resolvedSrc.startsWith("data:")) {
      return (
        <View key={ctx.getKey()} style={[pdfStyles.imagePlaceholder, alignmentStyle]}>
          <Text style={pdfStyles.imagePlaceholderText}>[Image: {assetId.slice(0, 8)}...]</Text>
        </View>
      );
    }

    const imageStyle = width && !isNaN(width) ? { width, maxHeight: 500 } : { maxWidth: 400, maxHeight: 500 };

    return (
      <View key={ctx.getKey()} style={[{ width: "100%" }, alignmentStyle]}>
        <Image src={resolvedSrc} style={[pdfStyles.image, imageStyle]} />
      </View>
    );
  },

  calloutComponent: (node: TipTapNode, children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const backgroundKey = (node.attrs?.["data-background"] as string) || "gray";
    const backgroundColor =
      EDITOR_BACKGROUND_COLORS[backgroundKey as keyof typeof EDITOR_BACKGROUND_COLORS] || BACKGROUND_COLORS.layer3;

    return (
      <View key={ctx.getKey()} style={[pdfStyles.callout, { backgroundColor }]}>
        <View style={pdfStyles.calloutIconContainer}>{getCalloutIcon(node, TEXT_COLORS.primary)}</View>
        <View style={[pdfStyles.calloutContent, { color: TEXT_COLORS.primary }]}>{children}</View>
      </View>
    );
  },

  mention: (node: TipTapNode, _children: ReactElement[], ctx: PDFRenderContext): ReactElement => {
    const id = (node.attrs?.id as string) || "";
    const entityIdentifier = (node.attrs?.entity_identifier as string) || "";
    const entityName = (node.attrs?.entity_name as string) || "";

    let displayText = entityName || id || entityIdentifier;

    if (ctx.metadata && (entityName === "user_mention" || entityName === "user")) {
      const userMention = ctx.metadata.userMentions?.find((u) => u.id === entityIdentifier || u.id === id);
      if (userMention) {
        displayText = userMention.display_name;
      }
    }

    return (
      <Text key={ctx.getKey()} style={pdfStyles.mention}>
        @{displayText}
      </Text>
    );
  },
};

/**
 * Internal traversal state threaded through `renderNodeWithContext`. The
 * underscore-prefixed `_parentType`, `_nestingLevel`, `_listItemIndex`,
 * `_textAlign`, and `_isHeader` attrs are injected onto each node's `attrs`
 * before lookup so individual renderers can read them without re-walking the
 * tree.
 */
type InternalRenderContext = {
  parentType?: string;
  nestingLevel: number;
  listItemIndex: number;
  textAlign?: string | null;
  pdfContext: PDFRenderContext;
};

/**
 * Depth-first traversal that recursively renders a node's children, computes
 * the next traversal context (incrementing list nesting only when the current
 * node is a list container directly under a `listItem`, propagating
 * `textAlign` inheritance from paragraph nodes), and dispatches to
 * `nodeRenderers[node.type]`. Falls back to a generic `<View>` with children
 * when no renderer is registered for the type.
 */
const renderNodeWithContext = (node: TipTapNode, context: InternalRenderContext): ReactElement => {
  const { parentType, nestingLevel, listItemIndex, textAlign, pdfContext } = context;

  const isListContainer = node.type === CORE_EXTENSIONS.BULLET_LIST || node.type === CORE_EXTENSIONS.ORDERED_LIST;

  let childTextAlign = textAlign;
  if (node.type === CORE_EXTENSIONS.PARAGRAPH && node.attrs?.textAlign) {
    childTextAlign = node.attrs.textAlign as string;
  }

  const nodeWithContext = {
    ...node,
    attrs: {
      ...node.attrs,
      _parentType: parentType,
      _nestingLevel: nestingLevel,
      _listItemIndex: listItemIndex,
      _textAlign: childTextAlign,
      _isHeader: node.content?.some((child) => child.type === CORE_EXTENSIONS.TABLE_HEADER),
    },
  };

  let childNestingLevel = nestingLevel;
  if (isListContainer && parentType === CORE_EXTENSIONS.LIST_ITEM) {
    childNestingLevel = nestingLevel + 1;
  }

  let currentListItemIndex = 0;
  const children: ReactElement[] =
    node.content?.map((child) => {
      const childContext: InternalRenderContext = {
        parentType: node.type,
        nestingLevel: childNestingLevel,
        listItemIndex: 0,
        textAlign: childTextAlign,
        pdfContext,
      };

      if (isListContainer && child.type === CORE_EXTENSIONS.LIST_ITEM) {
        currentListItemIndex++;
        childContext.listItemIndex = currentListItemIndex;
      }

      return renderNodeWithContext(child, childContext);
    }) || [];

  const renderer = nodeRenderers[node.type];
  if (renderer) {
    return renderer(nodeWithContext, children, pdfContext);
  }

  if (children.length > 0) {
    return <View key={pdfContext.getKey()}>{children}</View>;
  }

  return <View key={pdfContext.getKey()} />;
};

/**
 * Public entrypoint for rendering a single TipTap node (typically the document
 * root or a top-level block) to a React-PDF element.
 *
 * @param node       - The TipTap node to render.
 * @param parentType - Parent node type (e.g., `"doc"`) used by some renderers
 *                     to decide list-item numbering / bullets.
 * @param _index     - Reserved; currently ignored. Kept for backward
 *                     compatibility with callers passing the position in a
 *                     parent's `content[]`.
 * @param metadata   - Entity resolution + asset suppression
 *                     (`userMentions`, `resolvedImageUrls`, `noAssets`)
 *                     propagated to leaf renderers.
 * @param getKey     - Optional shared `KeyGenerator` so callers can reuse one
 *                     generator across multiple top-level `renderNode` calls
 *                     and keep all keys disjoint.
 * @returns A React-PDF element tree for the node.
 */
export const renderNode = (
  node: TipTapNode,
  parentType?: string,
  _index?: number,
  metadata?: PDFExportMetadata,
  getKey?: KeyGenerator
): ReactElement => {
  const keyGen = getKey ?? createKeyGenerator();

  return renderNodeWithContext(node, {
    parentType,
    nestingLevel: 0,
    listItemIndex: 0,
    pdfContext: { getKey: keyGen, metadata },
  });
};
