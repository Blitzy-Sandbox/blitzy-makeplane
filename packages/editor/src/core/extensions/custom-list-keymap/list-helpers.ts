/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Low-level ProseMirror traversal helpers for the Plane custom list keymap.
 *
 * Provides the structural inspection and edit-orchestration primitives that
 * `./list-keymap.ts` invokes from its `Backspace` / `Delete` / `Mod-Backspace`
 * / `Mod-Delete` shortcut handlers. The helpers walk the document tree to
 * compute list depth, sibling relationships, sub-list presence, and prior
 * list-block presence — operations that determine whether a keypress should
 * outdent, merge, lift, cut+append, or fall through to default editor
 * behavior.
 *
 * Exports (consumed by `./list-keymap.ts`):
 *   - `handleBackspace` — orchestrates the full Backspace decision tree
 *   - `handleDelete` — orchestrates the full Delete decision tree
 *   - `nextListIsHigher` — predicate used by `handleDelete` to detect
 *     forward cross-level merges
 *   - `isCursorInSubList` — predicate exposed for callers outside this
 *     folder that need to detect nested-list context
 *
 * The private helpers (`findListItemPos`, `getNextListDepth`,
 * `getPrevListDepth`, `nextListIsDeeper`, `hasListBefore`, `prevListIsHigher`,
 * `nextListIsSibling`, `listItemHasSubList`, `isCurrentParagraphASibling`,
 * `hasListItemBefore`) encapsulate logic that would otherwise repeat across
 * the exported handlers; they are intentionally NOT re-exported through
 * `./index.ts`.
 */

import type { Editor } from "@tiptap/core";
import { getNodeType, getNodeAtPosition, isAtEndOfNode, isAtStartOfNode, isNodeActive } from "@tiptap/core";
import type { Node, NodeType } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

/**
 * Walks up from the current selection's `$from` position until it finds an
 * ancestor of the given node type.
 *
 * Returns `{ $pos, depth }` where `$pos` is a fresh `ResolvedPos` at the
 * adjusted position and `depth` is the ProseMirror tree depth at which the
 * matching list item lives. Returns `null` when no matching ancestor exists
 * (cursor is outside any list of the requested type).
 *
 * WHY a manual walk instead of `findParentNode`: each ascending step both
 * decrements `currentDepth` AND `currentPos` by 1, mirroring ProseMirror's
 * coordinate model where leaving a node by 1 depth corresponds to crossing
 * 1 position. The returned `$pos` therefore sits at the START of the matched
 * list item — callers (e.g., `getNextListDepth`) add a fixed offset to peek
 * INSIDE without re-resolving the selection.
 */
const findListItemPos = (typeOrName: string | NodeType, state: EditorState) => {
  const { $from } = state.selection;
  const nodeType = getNodeType(typeOrName, state.schema);

  let currentNode: Node | null = null;
  let currentDepth = $from.depth;
  let currentPos = $from.pos;
  let targetDepth: number | null = null;

  while (currentDepth > 0 && targetDepth === null) {
    currentNode = $from.node(currentDepth);

    if (currentNode.type === nodeType) {
      targetDepth = currentDepth;
    } else {
      currentDepth -= 1;
      currentPos -= 1;
    }
  }

  if (targetDepth === null) {
    return null;
  }

  return { $pos: state.doc.resolve(currentPos), depth: targetDepth };
};

/**
 * Returns `true` if the next list block in the document tree is at a deeper
 * nesting level than the current list item.
 *
 * Used by `handleDelete` to detect when pressing Delete at the end of a list
 * item should pull a DEEPER nested list up into the current level
 * (`focus + lift + joinBackward`) rather than performing a simple sibling
 * merge.
 */
const nextListIsDeeper = (typeOrName: string, state: EditorState) => {
  const listDepth = getNextListDepth(typeOrName, state);
  const listItemPos = findListItemPos(typeOrName, state);

  if (!listItemPos || !listDepth) {
    return false;
  }

  if (listDepth > listItemPos.depth) {
    return true;
  }

  return false;
};

/**
 * Reads the ProseMirror tree depth at `listItemPos.$pos.pos + 4` — i.e.,
 * INSIDE the current list item's next sibling.
 *
 * WHY `+ 4`: ProseMirror's position model assigns 1 unit to each node
 * boundary (open + close). Stepping +4 from the start of a list item lands
 * inside the next adjacent block (skipping `listItem-close`, `paragraph-open`,
 * the first character, and `paragraph-close`). This is a fragile constant
 * that works only because list items in this editor always wrap a single
 * paragraph as their first child — preserved verbatim from the original
 * implementation.
 *
 * Returns the depth integer, or `false` if no list item ancestor exists.
 */
const getNextListDepth = (typeOrName: string, state: EditorState) => {
  const listItemPos = findListItemPos(typeOrName, state);

  if (!listItemPos) {
    return false;
  }

  const [, depth] = getNodeAtPosition(state, typeOrName, listItemPos.$pos.pos + 4);

  return depth;
};

/**
 * Counts the number of list ancestors at positions BEFORE the current list
 * item and returns a doubled, parent-relative depth value used by
 * `prevListIsHigher` and similar comparators.
 *
 * Algorithm:
 *   1. Resolve a position one step before the list item start (line 79).
 *   2. Iterate UP the tree from that position counting how many ancestors
 *      are `bulletList` / `orderedList` / `taskList` (lines 82–92).
 *   3. Subtract 1 to get the PARENT list's depth (lines 94–97 comment
 *      preserved).
 *   4. Double the result (lines 99–100) so the value can be compared
 *      directly against ProseMirror tree depths (which advance by 2 per
 *      list nesting level: one for the list container, one for the item).
 *
 * Returns a numeric depth (always even: 0, 2, 4, ...), or `false` if no
 * list item ancestor exists.
 */
const getPrevListDepth = (typeOrName: string, state: EditorState) => {
  const listItemPos = findListItemPos(typeOrName, state);

  if (!listItemPos) {
    return false;
  }

  let depth = 0;
  const pos = listItemPos.$pos;

  // Adjust the position to ensure we're within the list item, especially for edge cases
  const resolvedPos = state.doc.resolve(Math.max(pos.pos - 1, 0));

  // Traverse up the document structure from the adjusted position
  for (let d = resolvedPos.depth; d > 0; d--) {
    const node = resolvedPos.node(d);
    if (
      [CORE_EXTENSIONS.BULLET_LIST, CORE_EXTENSIONS.ORDERED_LIST, CORE_EXTENSIONS.TASK_LIST].includes(
        node.type.name as CORE_EXTENSIONS
      )
    ) {
      // Increment depth for each list ancestor found
      depth++;
    }
  }

  // Subtract 1 from the calculated depth to get the parent list's depth
  // This adjustment is necessary because the depth calculation includes the current list
  // By subtracting 1, we aim to get the depth of the parent list, which helps in identifying if the current list is a sublist
  depth = depth > 0 ? depth - 1 : 0;

  // Double the depth value to get results as 2, 4, 6, 8, etc.
  depth = depth * 2;

  return depth;
};

/**
 * Backspace handler for nested list items.
 *
 * Orchestrates the full Backspace decision tree at the start of a list item:
 *   1. If TipTap's input-rule undo applies, run it (handles "type `* ` to
 *      start list, then backspace to undo" UX).
 *   2. If a range is selected (not a cursor), fall through to default
 *      Backspace.
 *   3. If the cursor is OUTSIDE a list but the previous block IS a list of
 *      `parentListTypes`, cut the current content and append it to the
 *      LAST list item — preserves the user's typing when joining a paragraph
 *      back into a list.
 *   4. If the cursor is outside the named list type, or not at the start of
 *      the current node, fall through.
 *   5. Decision matrix on (current item has sub-list?) × (current item is a
 *      sub-list?) × (paragraph sibling?) × (next item is sibling?):
 *        - sub-list + nested + paragraph sibling → no-op (preserve structure)
 *        - sub-list + nested → lift + `joinItemBackward` (merge with prior)
 *        - nested + next is sibling → no-op
 *        - nested-only → no-op
 *        - has-sub-list only → no-op
 *        - has prior list item → lift one level (outdent)
 *        - has sub-list (tail branch) → no-op
 *        - default tail → `liftListItem(name)`
 *
 * WHY no-ops for sub-list cases: pressing Backspace inside an empty NESTED
 * list item must NOT delete the item from the parent list (it must outdent
 * or merge based on context). The intermediate no-op returns yield control
 * back to the editor's default Backspace, which respects the editor's
 * native nesting semantics for those specific configurations.
 *
 * Returns `true` if the handler consumed the keypress; `false` to fall
 * through.
 *
 * @param editor - Active `Editor` instance whose state is mutated.
 * @param name - List item node type name (`"listItem"` or `"taskItem"`).
 * @param parentListTypes - Container node names valid for this item type
 *   (e.g., `["bulletList", "orderedList"]` for `"listItem"`).
 */
export const handleBackspace = (editor: Editor, name: string, parentListTypes: string[]) => {
  // this is required to still handle the undo handling
  if (editor.commands.undoInputRule()) {
    return true;
  }
  // Check if a node range is selected, and if so, fall back to default backspace functionality
  const { from, to } = editor.state.selection;
  if (from !== to) {
    // A range is selected, not just a cursor position; fall back to default behavior
    return false; // Let the editor handle backspace by default
  }

  // if the current item is NOT inside a list item &
  // the previous item is a list (orderedList or bulletList)
  // move the cursor into the list and delete the current item
  if (!isNodeActive(editor.state, name) && hasListBefore(editor.state, name, parentListTypes)) {
    const { $anchor } = editor.state.selection;

    const $listPos = editor.state.doc.resolve($anchor.before() - 1);

    const listDescendants: Array<{ node: Node; pos: number }> = [];

    $listPos.node().descendants((node, pos) => {
      if (node.type.name === name) {
        listDescendants.push({ node, pos });
      }
    });

    const lastItem = listDescendants.at(-1);

    if (!lastItem) {
      return false;
    }

    const $lastItemPos = editor.state.doc.resolve($listPos.start() + lastItem.pos + 1);

    // Check if positions are within the valid range
    const startPos = $anchor.start() - 1;
    const endPos = $anchor.end() + 1;
    if (startPos < 0 || endPos > editor.state.doc.content.size) {
      return false; // Invalid position, abort operation
    }

    return editor.chain().cut({ from: startPos, to: endPos }, $lastItemPos.end()).joinForward().run();
  }

  // if the cursor is not inside the current node type
  // do nothing and proceed
  if (!isNodeActive(editor.state, name)) {
    return false;
  }

  // if the cursor is not at the start of a node
  // do nothing and proceed
  if (!isAtStartOfNode(editor.state)) {
    return false;
  }

  // is the paragraph node inside of the current list item (maybe with a hard break)
  const isParaSibling = isCurrentParagraphASibling(editor.state);
  const isCurrentListItemSublist = prevListIsHigher(name, editor.state);
  const listItemPos = findListItemPos(name, editor.state);
  const nextListItemIsSibling = nextListIsSibling(name, editor.state);

  if (!listItemPos) {
    return false;
  }

  const currentNode = listItemPos.$pos.node(listItemPos.depth);
  const currentListItemHasSubList = listItemHasSubList(name, editor.state, currentNode);

  if (currentListItemHasSubList && isCurrentListItemSublist && isParaSibling) {
    return false;
  }

  if (currentListItemHasSubList && isCurrentListItemSublist) {
    editor.chain().liftListItem(name).run();
    return editor.commands.joinItemBackward();
  }

  if (isCurrentListItemSublist && nextListItemIsSibling) {
    return false;
  }

  if (isCurrentListItemSublist) {
    return false;
  }

  if (currentListItemHasSubList) {
    return false;
  }

  if (hasListItemBefore(name, editor.state)) {
    return editor.chain().liftListItem(name).run();
  }

  if (!currentListItemHasSubList) {
    return false;
  }

  // otherwise in the end, a backspace should
  // always just lift the list item if
  // joining / merging is not possible
  return editor.chain().liftListItem(name).run();
};

/**
 * Delete handler for nested list items at the END of a list item.
 *
 * Decision tree at the end of a list item:
 *   1. If cursor is not inside the named list type → return false
 *      (default Delete).
 *   2. If cursor is not at the END of the current node → return false.
 *   3. If next list is DEEPER → `focus(selection.from + 4).lift(name).joinBackward()`:
 *      pulls a deeper-nested next item up to the current level so the
 *      content joins with the current item.
 *   4. If next list is HIGHER → `joinForward().joinBackward()`:
 *      bridges a forward and backward join to merge across a sibling
 *      list-container boundary.
 *   5. Otherwise → `joinItemForward()`: standard sibling-level forward
 *      merge.
 *
 * WHY the +4 focus offset before lift+joinBackward: the cursor at the end
 * of the current list item needs to be repositioned INSIDE the next list's
 * first item so the subsequent `lift(name)` and `joinBackward()` operate
 * on the correct depth boundary. The +4 mirrors the +4 in `getNextListDepth`
 * and follows the same "skip listItem-close + paragraph-open + first char
 * + paragraph-close" coordinate math.
 *
 * Returns `true` if the handler consumed the keypress; `false` to fall
 * through.
 *
 * @param editor - Active `Editor` instance whose state is mutated.
 * @param name - List item node type name (`"listItem"` or `"taskItem"`).
 */
export const handleDelete = (editor: Editor, name: string) => {
  // if the cursor is not inside the current node type
  // do nothing and proceed
  if (!isNodeActive(editor.state, name)) {
    return false;
  }

  // if the cursor is not at the end of a node
  // do nothing and proceed
  if (!isAtEndOfNode(editor.state, name)) {
    return false;
  }

  // check if the next node is a list with a deeper depth
  if (nextListIsDeeper(name, editor.state)) {
    return editor
      .chain()
      .focus(editor.state.selection.from + 4)
      .lift(name)
      .joinBackward()
      .run();
  }

  if (nextListIsHigher(name, editor.state)) {
    return editor.chain().joinForward().joinBackward().run();
  }

  return editor.commands.joinItemForward();
};

/**
 * Returns `true` if the node TWO positions before the current selection
 * anchor is one of the parent list container types.
 *
 * WHY `$anchor.pos - 2`: ProseMirror inserts one boundary unit each for the
 * close of the previous block and the open of the current block, so the
 * previous block's INTERNAL position is two units behind the current
 * cursor position. The resulting `previousNode.type.name` membership check
 * against `parentListTypes` tells `handleBackspace` whether to merge the
 * current (non-list) block into the prior list.
 */
const hasListBefore = (editorState: EditorState, name: string, parentListTypes: string[]) => {
  const { $anchor } = editorState.selection;

  const previousNodePos = Math.max(0, $anchor.pos - 2);

  const previousNode = editorState.doc.resolve(previousNodePos).node();

  if (!previousNode || !parentListTypes.includes(previousNode.type.name)) {
    return false;
  }

  return true;
};

/**
 * Returns `true` when the PARENT list's depth (from `getPrevListDepth`) is
 * less than the current list item's depth — i.e., the current item lives
 * inside a sub-list and its enclosing parent list is at a shallower level.
 *
 * Used by `handleBackspace` to detect when the cursor is in a NESTED list
 * item (as opposed to a top-level list item with no enclosing list above).
 */
const prevListIsHigher = (typeOrName: string, state: EditorState) => {
  const listDepth = getPrevListDepth(typeOrName, state);
  const listItemPos = findListItemPos(typeOrName, state);

  if (!listItemPos || !listDepth) {
    return false;
  }

  if (listDepth < listItemPos.depth) {
    return true;
  }

  return false;
};

/**
 * Returns `true` when the next list in the document is at the SAME depth
 * as the current list item — i.e., a sibling list rather than nested or
 * higher.
 *
 * Used by `handleBackspace` in the combined decision matrix to suppress
 * outdent/merge behavior when the user is editing a nested item whose
 * sibling at the same depth would be affected.
 */
const nextListIsSibling = (typeOrName: string, state: EditorState) => {
  const listDepth = getNextListDepth(typeOrName, state);
  const listItemPos = findListItemPos(typeOrName, state);

  if (!listItemPos || !listDepth) {
    return false;
  }

  if (listDepth === listItemPos.depth) {
    return true;
  }

  return false;
};

/**
 * Returns `true` when the next list block is at a SHALLOWER depth than the
 * current list item — i.e., a higher-level (less-nested) list follows the
 * current nested item.
 *
 * Used by `handleDelete` to detect forward cross-level merges that require
 * the `joinForward().joinBackward()` bridge rather than a simple
 * `joinItemForward()` sibling merge.
 */
export const nextListIsHigher = (typeOrName: string, state: EditorState) => {
  const listDepth = getNextListDepth(typeOrName, state);
  const listItemPos = findListItemPos(typeOrName, state);

  if (!listItemPos || !listDepth) {
    return false;
  }

  if (listDepth < listItemPos.depth) {
    return true;
  }

  return false;
};

/**
 * Returns `true` if the given node contains a descendant of type `typeOrName`.
 *
 * `handleBackspace` calls this with the current list item node to detect
 * "this item contains another list item" — i.e., it has a sub-list. The
 * sub-list detection determines whether Backspace should preserve
 * structure (no-op) or lift+join.
 */
const listItemHasSubList = (typeOrName: string, state: EditorState, node?: Node) => {
  if (!node) {
    return false;
  }

  const nodeType = getNodeType(typeOrName, state.schema);

  let hasSubList = false;

  node.descendants((child) => {
    if (child.type === nodeType) {
      hasSubList = true;
    }
  });

  return hasSubList;
};

/**
 * Returns `true` when the current cursor sits in a paragraph that has a
 * sibling paragraph inside the same list item — i.e., the list item
 * contains MULTIPLE paragraph children.
 *
 * WHY this matters: a list item with multiple paragraphs (separated by
 * hard breaks or explicit paragraph splits) needs distinct Backspace
 * semantics from a single-paragraph list item — the no-op branch in
 * `handleBackspace`'s decision matrix only triggers for nested-sub-list +
 * paragraph-sibling configurations so the cursor doesn't accidentally
 * merge two sibling paragraphs across a list-item boundary.
 */
const isCurrentParagraphASibling = (state: EditorState): boolean => {
  const { $from } = state.selection;
  const listItemNode = $from.node(-1); // Get the parent node of the current selection, assuming it's a list item.
  const currentParagraphNode = $from.parent; // Get the current node where the selection is.

  // Ensure we're in a paragraph and the parent is a list item.
  if (
    currentParagraphNode.type.name === CORE_EXTENSIONS.PARAGRAPH &&
    [CORE_EXTENSIONS.LIST_ITEM, CORE_EXTENSIONS.TASK_ITEM].includes(listItemNode.type.name as CORE_EXTENSIONS)
  ) {
    let paragraphNodesCount = 0;
    listItemNode.forEach((child) => {
      if (child.type.name === CORE_EXTENSIONS.PARAGRAPH) {
        paragraphNodesCount++;
      }
    });

    // If there are more than one paragraph nodes, the current paragraph is a sibling.
    return paragraphNodesCount > 1;
  }

  return false;
};

/**
 * Returns `true` when the cursor is inside a nested list — i.e., the
 * current `listItem` / `taskItem` has a parent that is itself a
 * `bulletList`, `orderedList`, or `taskList`.
 *
 * WHY walk depth-by-depth instead of using `findParentNode`: this helper
 * must distinguish NESTED list items (whose direct parent is another list
 * container) from TOP-LEVEL list items (whose direct parent is the
 * document root or a non-list block). Walking depths lets the helper
 * inspect the IMMEDIATE parent's type after locating any list item
 * ancestor, rather than just confirming "some list item exists somewhere
 * up the tree".
 *
 * Exported because consumers outside this folder need to detect
 * nested-list context (e.g., toolbar UI may render different controls
 * when the cursor is inside a sub-list).
 */
export function isCursorInSubList(editor: Editor) {
  const { selection } = editor.state;
  const { $from } = selection;

  // Check if the current node is a list item
  const listItem = editor.schema.nodes.listItem;
  const taskItem = editor.schema.nodes.taskItem;

  // Traverse up the document tree from the current position
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === listItem || node.type === taskItem) {
      // If the parent of the list item is also a list, it's a sub-list
      const parent = $from.node(depth - 1);
      if (
        parent &&
        (parent.type === editor.schema.nodes.bulletList ||
          parent.type === editor.schema.nodes.orderedList ||
          parent.type === editor.schema.nodes.taskList)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns `true` when there is a list ITEM of type `typeOrName` immediately
 * before the current cursor position WITHIN the same parent list.
 *
 * Used by `handleBackspace`'s outdent branch: when Backspace is pressed at
 * the start of a list item AND a list item of the same type exists right
 * before it, the handler lifts (outdents) the current item rather than
 * trying to merge into a paragraph or a different list type.
 *
 * The `$targetPos.index() === 0` guard catches the FIRST list item case
 * (no prior sibling at the same depth) and short-circuits to `false`.
 */
const hasListItemBefore = (typeOrName: string, state: EditorState): boolean => {
  const { $anchor } = state.selection;

  const $targetPos = state.doc.resolve($anchor.pos - 2);

  if ($targetPos.index() === 0) {
    return false;
  }

  if ($targetPos.nodeBefore?.type.name !== typeOrName) {
    return false;
  }

  return true;
};
