import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Modal built on a plain div rather than <dialog>, because the receipt preview needs to scroll
 * inside it on a phone and Safari's dialog sizing fights that.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Move focus in, so a keyboard or screen-reader user is not left behind on the page below.
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {/* The body scrolls, the heading and the buttons do not: a long receipt used to push the
            way out of the dialog below the bottom of the screen. */}
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-actions">{footer}</div> : null}
      </div>
    </div>
  );
}
