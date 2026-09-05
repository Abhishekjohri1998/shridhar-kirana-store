import type { Item } from './types';

/**
 * Spotting an item the shop already has.
 *
 * Two items with the same name are not forbidden -- loose sugar and packet sugar at different
 * rates is a real thing, and refusing to save the second one would be the software telling the
 * shopkeeper he is wrong about his own stock. But saving it silently is worse: both rows read
 * identically in the list and on the slip, and the only way to tell them apart is to remember
 * which one was cheaper.
 *
 * So the rule is: say so, and let him decide.
 */

/**
 * Names are compared with the punctuation and spacing a hurried hand leaves behind stripped out.
 *
 * Case folding is done for the Latin name only because Kannada has no case; `toLowerCase` is
 * harmless on it either way. Whitespace is collapsed rather than removed, so "chana dal" and
 * "chana  dal" match while "chanadal" stays its own thing -- someone who closed the gap on
 * purpose probably meant a different product.
 */
export function normaliseItemName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Just enough of an item to look for a clash: the two names, and its own id when editing. */
export type ItemNameCandidate = { id?: string; nameKn: string; nameEn: string };

/**
 * Every existing item whose Kannada or English name matches the candidate's.
 *
 * Either name colliding is enough: the Kannada one is what prints on the slip, and the English
 * one is what the search box finds, so a clash in either is a clash the shopkeeper will meet.
 * An item never clashes with itself, which is what makes this safe to run when editing a rate.
 */
export function findNameClashes(items: readonly Item[], candidate: ItemNameCandidate): Item[] {
  const kn = normaliseItemName(candidate.nameKn);
  const en = normaliseItemName(candidate.nameEn);

  return items.filter((item) => {
    if (candidate.id && item.id === candidate.id) return false;
    const itemKn = normaliseItemName(item.nameKn);
    const itemEn = normaliseItemName(item.nameEn);
    // An empty name is not a match for another empty name -- that is two blanks, not a duplicate.
    if (kn.length > 0 && itemKn === kn) return true;
    if (en.length > 0 && itemEn === en) return true;
    return false;
  });
}
