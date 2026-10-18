import { round2 } from './money';

/**
 * The value of a sum typed into a money box, or null if it is not one yet.
 *
 * Two kilos of sugar at 44 is 88, and until now the shopkeeper worked that out in his head while
 * a queue waited. The price and paid boxes now take `44*2` and answer 88.
 *
 * Written as a tokeniser rather than anything that reaches `eval` or `new Function`. Partly
 * because this is a field a customer can watch being typed into, and partly for the reason
 * `parseDecimal` already records next door: the built-in number parsing quietly accepts things a
 * shopkeeper never means -- `0x1f` is 31, `1e3` is 1000 -- and a till that reads a typo as a
 * number is worse than one that refuses it.
 *
 * `null` means "not a sum yet", which is what the field holds on almost every keystroke: `44*`
 * on the way to `44*2`. It must never come back as an error or as zero, or the line's price
 * would flicker to nothing between two taps.
 */
export function evaluateAmount(raw: string): number | null {
  const tokens = tokenise(raw);
  if (!tokens) return null;
  return fold(tokens);
}

/** True when there is an operator in here, so a caller knows whether to show the working. */
export function looksLikeSum(raw: string): boolean {
  return /[+\-*/x×÷]/i.test(raw.trim().replace(/^[+-]/, ''));
}

type Token = number | '+' | '-' | '*' | '/';

/**
 * Into numbers and operators, or null if anything is out of place.
 *
 * The shop may type `*` on the counter PC's keyboard and tap `×` on the tablet's strip, and both
 * have to mean the same thing; `x` is here because it is what people write by hand.
 */
function tokenise(raw: string): Token[] | null {
  const text = raw.trim().replace(/[x×]/gi, '*').replace(/[÷]/g, '/').replace(/[−–—]/g, '-');
  if (text === '') return null;

  const tokens: Token[] = [];
  let i = 0;
  // Spaces are skipped between tokens but never inside one, so `1 5` stays two numbers with
  // nothing joining them -- which is a slip, not fifteen. Stripping every space first would
  // have quietly turned it into 15.
  const skipSpaces = () => { while (i < text.length && text[i] === ' ') i += 1; };
  // A sum must start with a number: a leading minus would make a negative price, which every
  // money field refuses anyway, and `-5` as a price is far more likely to be a slip than intent.
  let expecting: 'number' | 'operator' = 'number';

  while (i < text.length) {
    skipSpaces();
    if (i >= text.length) break;
    const c = text[i]!;
    if (expecting === 'number') {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j]!)) j += 1;
      const piece = text.slice(i, j);
      // One dot at most, and at least one digit: `44..2` and a bare `.` are both nothing.
      if (piece === '' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(piece)) return null;
      tokens.push(Number(piece));
      if (!Number.isFinite(tokens[tokens.length - 1] as number)) return null;
      i = j;
      expecting = 'operator';
    } else {
      if (c !== '+' && c !== '-' && c !== '*' && c !== '/') return null;
      tokens.push(c);
      i += 1;
      expecting = 'number';
    }
  }

  // Ends on an operator: `44*`, which is a sum halfway typed rather than a wrong one.
  if (expecting === 'number') return null;
  return tokens;
}

/** Multiply and divide first, then add and subtract, the way it is taught and expected. */
function fold(tokens: Token[]): number | null {
  const rest: Token[] = [tokens[0]!];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i] as Token;
    const rhs = tokens[i + 1] as number;
    if (op === '*' || op === '/') {
      const lhs = rest.pop() as number;
      if (op === '/' && rhs === 0) return null;
      rest.push(op === '*' ? lhs * rhs : lhs / rhs);
    } else {
      rest.push(op, rhs);
    }
  }

  let total = rest[0] as number;
  for (let i = 1; i < rest.length; i += 2) {
    const op = rest[i] as Token;
    const rhs = rest[i + 1] as number;
    total = op === '+' ? total + rhs : total - rhs;
  }

  return Number.isFinite(total) ? round2(total) : null;
}

/**
 * The pop-up calculator's sum (build 71): + - x / with brackets, decimals and %, still with no
 * eval. `%` after a number is a percentage of it (`200*5%` is 10); after `a +` or `a -` it is
 * a percentage of `a` (`200+5%` is 210), the way a shop calculator does it. Null when the sum
 * is not finished or not a sum.
 */
export function evaluateCalc(raw: string): number | null {
  const text = raw.replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').replace(/\s+/g, '');
  if (!text) return null;
  let i = 0;
  const peek = () => text[i];
  const fail = { bad: true };
  const num = (): number => {
    const m = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(i));
    if (!m) throw fail;
    i += m[0].length;
    return Number(m[0]);
  };
  const atom = (): number => {
    if (peek() === '-') { i += 1; return -atom(); }
    if (peek() === '(') {
      i += 1;
      const v = expr();
      if (peek() !== ')') throw fail;
      i += 1;
      return v;
    }
    return num();
  };
  // A factor, with a trailing % meaning "of a hundred" (callers adjust for + and -).
  const factor = (): { v: number; pct: boolean } => {
    const v = atom();
    if (peek() === '%') { i += 1; return { v: v / 100, pct: true }; }
    return { v, pct: false };
  };
  const term = (): { v: number; pct: boolean } => {
    let { v, pct } = factor();
    while (peek() === '*' || peek() === '/') {
      const op = text[i++];
      const r = factor().v;
      if (op === '/' && r === 0) throw fail;
      v = op === '*' ? v * r : v / r;
      pct = false;
    }
    return { v, pct };
  };
  function expr(): number {
    let v = term().v;
    while (peek() === '+' || peek() === '-') {
      const op = text[i++];
      const r = term();
      const add = r.pct ? v * r.v : r.v;
      v = op === '+' ? v + add : v - add;
    }
    return v;
  }
  try {
    const v = expr();
    if (i !== text.length || !Number.isFinite(v)) return null;
    return Math.round(v * 1e6) / 1e6;
  } catch {
    return null;
  }
}

/**
 * Where the calculator's "Put in box" goes (build 71): the price or qty box last focused on the
 * bill registers itself here, and the pop-up in the top bar puts its answer through it. One per
 * app; plain functions, so the web page and the tablet screen share it unchanged. F10 and the
 * top-bar button both open the pop-up through `open`.
 */
export function createCalcBus() {
  let target: { put: (text: string) => void } | null = null;
  const openers = new Set<() => void>();
  return {
    /** A price or qty box took focus: it is where the next answer goes. */
    setTarget(put: (text: string) => void) { target = { put }; },
    /** A box that went away (its line removed, the bill closed). */
    clearTarget() { target = null; },
    hasTarget() { return target != null; },
    /** The answer into the last box. False when no box has been focused yet. */
    put(value: number): boolean {
      if (!target || !Number.isFinite(value)) return false;
      target.put(String(Math.round(value * 1000) / 1000));
      return true;
    },
    onOpen(fn: () => void) { openers.add(fn); return () => { openers.delete(fn); }; },
    open() { for (const fn of openers) fn(); },
  };
}

export const calcBus = createCalcBus();
