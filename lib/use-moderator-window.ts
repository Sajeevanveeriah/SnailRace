'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CLUB_TITLE } from './club';

export interface ModeratorTarget { window: Window; root: HTMLElement }

/** Where this tab remembers its desk window's name across a reload. */
const WINDOW_NAME_KEY = 'ndcc-moderator-window';
/** How long an orphaned desk waits for its projector to come back before closing itself. */
const ORPHAN_GRACE_MS = 15_000;

const rememberName = (name: string) => {
  try { sessionStorage.setItem(WINDOW_NAME_KEY, name); } catch { /* the desk still opens; it is just not reclaimed after a reload */ }
};
const forgetName = () => {
  try { sessionStorage.removeItem(WINDOW_NAME_KEY); } catch { /* nothing remembered */ }
};
const rememberedName = (): string => {
  try { return sessionStorage.getItem(WINDOW_NAME_KEY) ?? ''; } catch { return ''; }
};

/** A second document, not a second app. React portals keep the race, audio,
 * Phone Play and settlement in their original, single owning window. */
/** `holder`: this tab holds the show. A mirror tab never opens, reclaims or keeps the desk. */
export function useModeratorWindow(holder = true) {
  const [target, setTarget] = useState<ModeratorTarget | null>(null);
  const [notice, setNotice] = useState('');
  const current = useRef<ModeratorTarget | null>(null);
  const windowName = useRef('');

  const mount = useCallback((popup: Window) => {
    const doc = popup.document;
    doc.documentElement.lang = 'en-AU';
    doc.documentElement.dataset.theme = 'dark';
    const base = doc.createElement('base');
    base.href = document.baseURI;
    const viewport = doc.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    // Copy styles only. Copying app scripts would create another race engine.
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'), (node) => node.cloneNode(true));
    doc.head.replaceChildren(base, viewport, ...styles);
    doc.title = `Moderator desk | ${CLUB_TITLE}`;
    const root = doc.createElement('div');
    root.id = 'moderator-root';
    doc.body.className = 'moderator-body';
    /* "live" tells an orphan timer, if one is running, that the projector is back. */
    doc.body.dataset.live = 'live';
    doc.body.replaceChildren(root);
    const next = { window: popup, root };
    current.current = next;
    setTarget(next);
    setNotice('');
  }, []);

  const open = useCallback(() => {
    if (!holder) return;
    if (current.current && !current.current.window.closed) {
      current.current.window.focus();
      return;
    }
    if (!windowName.current) windowName.current = `ndcc-moderator-${crypto.randomUUID()}`;
    const popup = window.open('', windowName.current, 'popup,width=1280,height=820,resizable=yes,scrollbars=yes');
    if (!popup) {
      setNotice('The moderator window was blocked. Allow pop-ups for this site, then try again. Controls are still available here.');
      return;
    }
    rememberName(windowName.current);
    mount(popup);
    popup.focus();
  }, [mount, holder]);

  const close = useCallback(() => {
    current.current?.window.close();
    current.current = null;
    forgetName();
    setTarget(null);
    setNotice('Moderator window closed. The show continues here.');
  }, []);

  /*
   * A reload of the projector page takes its desk back. The desk is a named
   * window, and a window that already carries the name is handed back by
   * `window.open` without opening anything new, so the volunteer is not sent
   * hunting for the desk after an accidental reload mid-race. The name lives
   * in sessionStorage, which a reload keeps and a closed tab does not.
   */
  /* A tab that becomes a mirror lets go of the desk without closing it: the tab that holds the show takes it. */
  useEffect(() => {
    if (holder || !current.current) return;
    current.current = null;
    const id = window.setTimeout(() => setTarget(null), 0);
    return () => window.clearTimeout(id);
  }, [holder]);

  useEffect(() => {
    if (!holder) return;
    const name = rememberedName();
    if (!name || current.current) return;
    const id = window.setTimeout(() => {
      let popup: Window | null = null;
      try {
        popup = window.open('', name);
        /* No desk by that name was open after all: the call opened an empty window. Close it again. */
        if (popup && popup.document.body?.dataset.live !== 'waiting' && !popup.document.getElementById('moderator-root')) {
          popup.close();
          popup = null;
        }
      } catch {
        popup = null;
      }
      if (!popup || popup.closed) {
        forgetName();
        setNotice('The moderator window closed with the reload. Press D or Open desk to reopen it. Controls are available here.');
        return;
      }
      windowName.current = name;
      mount(popup);
    }, 0);
    return () => window.clearTimeout(id);
  }, [mount, holder]);

  useEffect(() => {
    if (!target) return;
    const poll = window.setInterval(() => {
      if (target.window.closed) {
        current.current = null;
        forgetName();
        setTarget(null);
        setNotice('Moderator window closed. The show continues here. Press D to reopen it.');
        return;
      }
      try {
        // A reload of the desk rebuilds the portal from the current live state.
        if (target.root.ownerDocument !== target.window.document || !target.root.isConnected) mount(target.window);
      } catch {
        // If the user navigated the window away, relinquish it, not the game.
        current.current = null;
        forgetName();
        setTarget(null);
        setNotice('The moderator window left the show. Open a new moderator window to continue.');
      }
    }, 500);
    return () => window.clearInterval(poll);
  }, [target, mount]);

  /*
   * When this page goes away the desk is not closed at once: a reload will
   * reclaim it. It is told to wait, and it closes itself if no projector
   * reclaims it in time, so a desk is never left behind a closed tab.
   */
  useEffect(() => {
    const end = () => {
      const desk = current.current;
      if (!desk || desk.window.closed) return;
      try {
        const doc = desk.window.document;
        doc.body.dataset.live = 'waiting';
        doc.body.replaceChildren();
        const note = doc.createElement('p');
        note.className = 'desk-orphan';
        note.textContent = 'The projector page is reloading. This desk reconnects when it is back, or closes itself.';
        doc.body.appendChild(note);
        const script = doc.createElement('script');
        script.textContent = `setTimeout(function () { if (document.body.dataset.live !== 'live') window.close(); }, ${ORPHAN_GRACE_MS});`;
        doc.body.appendChild(script);
      } catch {
        desk.window.close();
      }
    };
    window.addEventListener('pagehide', end);
    return () => { window.removeEventListener('pagehide', end); end(); };
  }, []);

  return { target, open, close, notice };
}
