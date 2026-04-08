import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30_000;

interface Props {
  sessionId: string;
  visible: boolean;
  onActivity?: () => void;
  onSessionClosed?: (sessionId: string) => void;
}

/** Embeddable terminal panel — stays mounted while hidden, reconnects on visibility. */
export function TerminalPanel({ sessionId, visible, onActivity, onSessionClosed }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Keep onActivity in a ref to avoid stale closures in the WebSocket handler
  const onActivityRef = useRef(onActivity);
  useEffect(() => { onActivityRef.current = onActivity; }, [onActivity]);
  const onSessionClosedRef = useRef(onSessionClosed);
  useEffect(() => { onSessionClosedRef.current = onSessionClosed; }, [onSessionClosed]);

  // Refit + repaint when becoming visible
  useEffect(() => {
    if (!visible || !fitRef.current || !termRef.current) return;
    const timer = setTimeout(() => {
      fitRef.current!.fit();
      const ws = wsRef.current;
      const term = termRef.current!;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols + 1, rows: term.rows }));
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [visible]);

  // Setup xterm + websocket — runs once per sessionId
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      scrollback: 5000,
      theme: { background: '#1a1a2e', foreground: '#e0e0e0', cursor: '#e0e0e0' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    let activeWs: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    let handleResize: (() => void) | null = null;
    let closedForGood = false;

    async function sessionIsGone() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) return true;
        const session = await res.json();
        return session?.status === 'dead';
      } catch {
        return false;
      }
    }

    function connectWs(attempt = 0) {
      if (disposed || closedForGood) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/ws/terminal/${sessionId}`);
      activeWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        term.clear();
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols + 1, rows: term.rows }));
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        }, 100);

        ws.onmessage = (e) => {
          onActivityRef.current?.();
          if (e.data instanceof Blob) {
            e.data.text().then((t) => term.write(t));
          } else {
            term.write(e.data);
          }
        };

        dataDisposable?.dispose();
        dataDisposable = term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'data', data }));
          }
        });

        if (!handleResize) {
          handleResize = () => {
            fit.fit();
            if (activeWs?.readyState === WebSocket.OPEN) {
              activeWs.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
            }
          };
          window.addEventListener('resize', handleResize);
        }
      };

      ws.onclose = async (event) => {
        if (disposed) return;
        const shouldClose = event.code === 4004 || await sessionIsGone();
        if (disposed) return;
        if (shouldClose) {
          closedForGood = true;
          onSessionClosedRef.current?.(sessionId);
          return;
        }
        const delay = Math.min(RECONNECT_BASE * Math.pow(2, attempt), RECONNECT_MAX);
        reconnectTimer = setTimeout(() => connectWs(attempt + 1), delay * (0.5 + Math.random() * 0.5));
      };
      ws.onerror = () => {};
    }

    connectWs();

    // Intercept scroll for tmux copy-mode
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const lines = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 40));
      if (activeWs?.readyState === WebSocket.OPEN) {
        activeWs.send(JSON.stringify({ type: 'scroll', lines }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });

    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (handleResize) window.removeEventListener('resize', handleResize);
      dataDisposable?.dispose();
      activeWs?.close();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div className={`terminal-panel${visible ? ' terminal-panel--visible' : ''}`}>
      <div ref={containerRef} className="terminal-panel-inner" />
    </div>
  );
}
