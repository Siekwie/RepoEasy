import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hidden);

/**
 * Modal dialog shell: moves focus in once when it opens (to `[data-autofocus]`, else the first control),
 * keeps Tab inside, closes on Escape or a click on the scrim, and gives focus back to whatever opened it.
 * `onClose` is read through a ref so a parent re-rendering with a fresh arrow never re-runs any of this.
 */
export function Modal({ onClose, labelledBy, children }: { onClose: () => void; labelledBy: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(dialog)[0] ?? dialog).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const cur = document.activeElement;
      if (!dialog.contains(cur)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (cur === first || cur === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop click is a shortcut; Escape and the dialog's buttons close it by keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
