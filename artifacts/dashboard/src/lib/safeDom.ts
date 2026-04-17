/**
 * Workaround for the well-known React + browser-translation bug.
 *
 * Extensions like Google Translate / Chrome auto-translate replace text nodes
 * in-place. When React's reconciler later tries `parent.removeChild(child)` or
 * `parent.insertBefore(newNode, refNode)`, the `child`/`refNode` reference no
 * longer matches what's actually in the DOM, and the browser throws:
 *   "Failed to execute 'removeChild' on 'Node': The node to be removed is
 *    not a child of this node."
 *
 * The safest, smallest fix is to monkey-patch these two Node methods so that
 * when the precondition fails we silently no-op (or fall back to a direct
 * append) instead of throwing — letting React continue its render cycle.
 *
 * This patch is idempotent and only runs in the browser.
 */
export function installSafeDomPatches(): void {
  if (typeof Node === "undefined") return;
  const proto = Node.prototype as unknown as {
    __safePatched?: boolean;
    removeChild: <T extends Node>(child: T) => T;
    insertBefore: <T extends Node>(newNode: T, ref: Node | null) => T;
  };
  if (proto.__safePatched) return;
  proto.__safePatched = true;

  const origRemove = proto.removeChild;
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      // Translation extension already moved/replaced this node — pretend success.
      return child;
    }
    return origRemove.call(this, child) as T;
  };

  const origInsert = proto.insertBefore;
  proto.insertBefore = function <T extends Node>(this: Node, newNode: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      // Reference node is gone — fall back to plain append so we don't throw.
      return this.appendChild(newNode) as T;
    }
    return origInsert.call(this, newNode, ref) as T;
  };
}
