/**
 * Latin-to-Kannada transliteration, so the shopkeeper can type item names without a Kannada
 * keyboard installed on the device.
 *
 * Handwriting covers regional language without any of this -- a pen stroke has no script. But
 * item names in the catalogue are typed once and searched often, and a tablet that has never had
 * Gboard's Kannada layout added cannot produce ಅಕ್ಕಿ at all. Typing "akki" can.
 *
 * The mapping is the usual ITRANS-style one: doubled or capital letters mark the long vowels and
 * the retroflex consonants. It is deliberately paired with a live preview in the UI, because no
 * scheme guesses every word right and seeing the output is what makes a wrong guess fixable.
 */

/** Longest keys first within each group: 'chh' must win over 'ch', and 'ch' over 'c'. */
const CONSONANTS: [string, string][] = [
  ['chh', 'ಛ'],
  ['kh', 'ಖ'], ['gh', 'ಘ'], ['~g', 'ಙ'],
  ['ch', 'ಚ'], ['jh', 'ಝ'], ['~j', 'ಞ'],
  ['Th', 'ಠ'], ['Dh', 'ಢ'],
  ['th', 'ಥ'], ['dh', 'ಧ'],
  ['ph', 'ಫ'], ['bh', 'ಭ'],
  ['sh', 'ಶ'], ['Sh', 'ಷ'],
  ['k', 'ಕ'], ['g', 'ಗ'],
  ['j', 'ಜ'],
  ['T', 'ಟ'], ['D', 'ಡ'], ['N', 'ಣ'],
  ['t', 'ತ'], ['d', 'ದ'], ['n', 'ನ'],
  ['p', 'ಪ'], ['b', 'ಬ'], ['m', 'ಮ'],
  ['y', 'ಯ'], ['r', 'ರ'], ['l', 'ಲ'], ['L', 'ಳ'],
  ['v', 'ವ'], ['w', 'ವ'],
  ['s', 'ಸ'], ['h', 'ಹ'],
];

/** [key, independent vowel, vowel sign]. The sign for 'a' is empty: it is inherent. */
const VOWELS: [string, string, string][] = [
  ['aa', 'ಆ', 'ಾ'], ['ai', 'ಐ', 'ೈ'], ['au', 'ಔ', 'ೌ'],
  ['ee', 'ಏ', 'ೇ'], ['ii', 'ಈ', 'ೀ'], ['oo', 'ಓ', 'ೋ'], ['uu', 'ಊ', 'ೂ'],
  ['Ru', 'ಋ', 'ೃ'],
  ['A', 'ಆ', 'ಾ'], ['I', 'ಈ', 'ೀ'], ['U', 'ಊ', 'ೂ'], ['E', 'ಏ', 'ೇ'], ['O', 'ಓ', 'ೋ'],
  ['a', 'ಅ', ''], ['i', 'ಇ', 'ಿ'], ['u', 'ಉ', 'ು'], ['e', 'ಎ', 'ೆ'], ['o', 'ಒ', 'ೊ'],
];

const VIRAMA = '್';
const ANUSVARA = 'ಂ';
const VISARGA = 'ಃ';

function matchAt(source: string, at: number, keys: string[]): string | null {
  for (const key of keys) {
    if (source.startsWith(key, at)) return key;
  }
  return null;
}

const CONSONANT_KEYS = CONSONANTS.map(([k]) => k);
const VOWEL_KEYS = VOWELS.map(([k]) => k);
const CONSONANT_MAP = new Map(CONSONANTS);
const VOWEL_MAP = new Map(VOWELS.map(([k, independent, sign]) => [k, { independent, sign }]));

/**
 * "akki" -> ಅಕ್ಕಿ, "sakkare" -> ಸಕ್ಕರೆ, "eNNe" -> ಎಣ್ಣೆ.
 *
 * A consonant with no vowel after it takes a virama, which is what makes clusters like "kk" come
 * out as ಕ್ಕ rather than two separate syllables. Anything the tables do not know -- digits,
 * spaces, punctuation, Kannada that is already Kannada -- passes through untouched.
 */
export function latinToKannada(input: string): string {
  let out = '';
  let pending: string | null = null;
  let at = 0;

  const flush = (withVirama: boolean) => {
    if (pending == null) return;
    out += pending + (withVirama ? VIRAMA : '');
    pending = null;
  };

  while (at < input.length) {
    const consonant = matchAt(input, at, CONSONANT_KEYS);
    if (consonant) {
      // A consonant following a consonant means a cluster, so the first one loses its inherent 'a'.
      flush(true);
      pending = CONSONANT_MAP.get(consonant) as string;
      at += consonant.length;
      continue;
    }

    const vowel = matchAt(input, at, VOWEL_KEYS);
    if (vowel) {
      const { independent, sign } = VOWEL_MAP.get(vowel)!;
      if (pending != null) {
        out += pending + sign;
        pending = null;
      } else {
        out += independent;
      }
      at += vowel.length;
      continue;
    }

    const ch = input[at] as string;
    if (ch === 'M') {
      // Anusvara rides on the syllable already built, keeping its inherent vowel.
      flush(false);
      out += ANUSVARA;
      at += 1;
      continue;
    }
    if (ch === 'H') {
      flush(false);
      out += VISARGA;
      at += 1;
      continue;
    }

    flush(true);
    out += ch;
    at += 1;
  }

  flush(true);
  return out;
}

/** True if the text contains at least one Kannada character. */
export function hasKannada(text: string): boolean {
  return /[ಀ-೿]/.test(text);
}
