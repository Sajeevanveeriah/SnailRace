'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ModeratorTarget { window: Window; root: HTMLElement }

/** A second document, not a second app. React portals keep the race, audio,
 * Phone Play and settlement in their original, single owning window. */
export function useModeratorWindow() {
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
    doc.title = 'Moderator desk | NDCC Snail Race';
    const root = doc.createElement('div');
    root.id = 'moderator-root';
    doc.body.className = 'moderator-body';
    doc.body.replaceChildren(root);
    const next = { window: popup, root };
    current.current = next;
    setTarget(next);
    setNotice('');
  }, []);

  const open = useCallback(() => {
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
    mount(popup);
    popup.focus();
  }, [mount]);

  const close = useCallback(() => {
    current.current?.window.close();
    current.current = null;
    setTarget(null);
    setNotice('Moderator window closed. The show continues here.');
  }, []);

  useEffect(() => {
    if (!target) return;
    const poll = window.setInterval(() => {
      if (target.window.closed) {
        current.current = null;
        setTarget(null);
        setNotice('Moderator window closed. The show continues here.');
        return;
      }
      try {
        // A reload of the desk rebuilds the portal from the current live state.
        if (target.root.ownerDocument !== target.window.document || !target.root.isConnected) mount(target.window);
      } catch {
        // If the user navigated the window away, relinquish it, not the game.
        current.current = null;
        setTarget(null);
        setNotice('The moderator window left the show. Open a new moderator window to continue.');
      }
    }, 500);
    return () => window.clearInterval(poll);
  }, [target, mount]);

  useEffect(() => {
    const end = () => current.current?.window.close();
    window.addEventListener('pagehide', end);
    return () => { window.removeEventListener('pagehide', end); end(); };
  }, []);

  return { target, open, close, notice };
}
