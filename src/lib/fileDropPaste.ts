import * as api from './tauri';
import type { EnvType } from '../types/generated/EnvType';

/**
 * Pasting an OS file drop into an agent terminal.
 *
 * Files dragged from Windows Explorer / macOS Finder arrive via Tauri's native
 * webview drag-drop event (`getCurrentWebview().onDragDropEvent`), NOT the HTML5
 * `drop` event — the native handler intercepts the OS drop before the DOM sees
 * it, and browsers never expose `File.path` for security. The Tauri event hands
 * us the real absolute paths, which is exactly what we want to paste.
 */

/** Minimal surface of an xterm.js terminal we need to inject a dropped path. */
export interface PasteTarget {
  paste(text: string): void;
  focus(): void;
}

/** Wrap a path in double quotes if it contains whitespace, so a shell treats it
 * as a single argument rather than splitting on the space. */
export function quotePathIfNeeded(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * Convert raw OS drop paths to host paths and join them into a single string
 * ready to paste. `to_host_path` is a no-op for native paths and normalises
 * WSL/Git-Bash styles; quoting protects paths with spaces.
 */
export async function resolveDropText(rawPaths: string[], env: EnvType): Promise<string> {
  const convertPath = env === 'wsl' ? api.toGuestPath : api.toHostPath;
  const resolvedPaths = await Promise.all(rawPaths.map((p) => convertPath(p)));
  return resolvedPaths.filter(Boolean).map(quotePathIfNeeded).join(' ');
}

/** Resolve drop paths and paste them into the given terminal, then focus it. */
export async function pasteDropPaths(
  target: PasteTarget,
  rawPaths: string[],
  env: EnvType,
): Promise<void> {
  const text = await resolveDropText(rawPaths, env);
  if (!text) return;
  target.paste(text);
  target.focus();
}

/**
 * Map a CSS-pixel point to the agent node id whose terminal container sits under
 * it, or null if the point is not over a terminal. Containers tag themselves with
 * `data-node-id`; we walk up from the topmost element at the point.
 */
export function nodeIdFromPoint(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y);
  const host = el?.closest('[data-node-id]') as HTMLElement | null;
  if (!host) return null;
  const id = Number(host.dataset.nodeId);
  return Number.isInteger(id) ? id : null;
}
