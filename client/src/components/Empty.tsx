import type { ReactNode } from 'react';

/**
 * What a screen shows when there is nothing on it yet.
 *
 * A single grey sentence floating in an otherwise blank page reads as a page that failed to load.
 * The same sentence inside a drawn frame, under the icon for the section it belongs to, reads as
 * a page that is simply empty -- which on the first morning is the truth.
 */
export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <p className="empty-text">{children}</p>
    </div>
  );
}
