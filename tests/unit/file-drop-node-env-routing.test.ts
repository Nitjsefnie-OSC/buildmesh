import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileDropToTerminal } from '../../src/hooks/useFileDropToTerminal';
import { useAgentNodeStore, type AgentNode } from '../../src/stores/agentNodeStore';

const harness = vi.hoisted(() => ({
  dropHandlers: [] as Array<(event: { payload: unknown }) => void>,
  invoke: vi.fn(),
  terminalInstances: new Map<number, { term: { paste: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> } }>(),
  guestPaths: new Map<string, string>(),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (event: { payload: unknown }) => void) => {
      harness.dropHandlers.push(handler);
      return Promise.resolve(() => {});
    },
  }),
}));

vi.mock('../../src/components/Terminal/Terminal', () => ({
  terminalManager: {
    getInstance: (nodeId: number) => harness.terminalInstances.get(nodeId),
  },
}));

vi.mock('../../src/hooks/useAsyncEffect', () => ({
  useAsyncEffect: (effect: (signal: AbortSignal) => void | (() => void)) => {
    effect(new AbortController().signal);
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: harness.invoke,
}));

const HOST_PATH = 'C:\\Users\\adam\\file.txt';
const GUEST_PATH = '/mnt/c/Users/adam/file.txt';

function makeNode(id: number, env: AgentNode['env']): AgentNode {
  return {
    id,
    mesh_id: 1,
    name: `node-${id}`,
    path: 'C:\\repo',
    branch: 'main',
    env,
    provider: 'terminal',
    status: 'idle',
    cli_session_id: null,
    worktree_name: null,
    use_worktree: false,
    is_pinned: false,
    source_issue: null,
    source_pr: null,
    head_repo_owner: null,
    head_repo_clone_url: null,
    source_pr_pinned_sha: null,
    position: id,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function installTerminal(nodeId: number) {
  const target = { paste: vi.fn(), focus: vi.fn() };
  harness.terminalInstances.set(nodeId, { term: target });
  return target;
}

async function fireDrop(nodeId: number, paths: string[], nodes: AgentNode[], activeNodeId: number | null = null) {
  // Register while the store is empty, then seed it. This preserves the real
  // startup ordering and catches a store snapshot taken during registration.
  useFileDropToTerminal();
  useAgentNodeStore.setState({ agentNodes: nodes, activeNodeId });

  const host = document.createElement('div');
  host.dataset.nodeId = String(nodeId);
  document.elementFromPoint = () => host;

  const handler = harness.dropHandlers.at(-1);
  if (!handler) throw new Error('drop handler was not registered');
  handler({
    payload: {
      type: 'drop',
      position: { x: 10, y: 10 },
      paths,
    },
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  harness.dropHandlers.length = 0;
  harness.terminalInstances.clear();
  harness.guestPaths.clear();
  harness.guestPaths.set(HOST_PATH, GUEST_PATH);
  harness.invoke.mockReset();
  harness.invoke.mockImplementation((command: string, args: { path: string }) => {
    if (command === 'to_guest_path') {
      return Promise.resolve(harness.guestPaths.get(args.path) ?? args.path);
    }
    return Promise.resolve(args.path);
  });
  useAgentNodeStore.setState({ agentNodes: [], activeNodeId: null });
});

describe('file-drop routing by hit-tested agent-node environment', () => {
  it('pastes the guest value for a WSL node', async () => {
    const target = installTerminal(7);

    await fireDrop(7, [HOST_PATH], [makeNode(7, 'wsl')]);

    expect(target.paste).toHaveBeenCalledWith(GUEST_PATH);
    expect(harness.invoke).toHaveBeenCalledWith('to_guest_path', { path: HOST_PATH });
  });

  it('keeps Windows nodes on base behavior even when another node is active', async () => {
    const target = installTerminal(8);

    await fireDrop(8, [HOST_PATH], [makeNode(7, 'wsl'), makeNode(8, 'windows')], 7);

    expect(target.paste).toHaveBeenCalledWith(HOST_PATH);
    expect(harness.invoke).toHaveBeenCalledWith('to_host_path', { path: HOST_PATH });
  });

  it('fails open to base behavior when the hit-tested node is missing', async () => {
    const target = installTerminal(99);

    await fireDrop(99, [HOST_PATH], [makeNode(7, 'wsl')]);

    expect(target.paste).toHaveBeenCalledWith(HOST_PATH);
    expect(harness.invoke).toHaveBeenCalledWith('to_host_path', { path: HOST_PATH });
  });

  it('preserves multi-path order, joining, and whitespace quoting on WSL nodes', async () => {
    const first = 'C:\\a.txt';
    const second = 'C:\\My File.txt';
    harness.guestPaths.set(first, '/mnt/c/a.txt');
    harness.guestPaths.set(second, '/home/adam/My File.txt');
    const target = installTerminal(7);

    await fireDrop(7, [first, second], [makeNode(7, 'wsl')]);

    expect(harness.invoke.mock.calls.map(([command]) => command)).toEqual([
      'to_guest_path',
      'to_guest_path',
    ]);
    expect(target.paste).toHaveBeenCalledWith('/mnt/c/a.txt "/home/adam/My File.txt"');
  });

  it('filters empty converted paths before joining', async () => {
    const empty = 'C:\\empty.txt';
    const value = 'C:\\value.txt';
    harness.guestPaths.set(empty, '');
    harness.guestPaths.set(value, '/mnt/c/value.txt');
    const target = installTerminal(7);

    await fireDrop(7, [empty, value], [makeNode(7, 'wsl')]);

    expect(target.paste).toHaveBeenCalledWith('/mnt/c/value.txt');
  });
});
