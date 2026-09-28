/**
 * Converts a whole-shilling UGX amount into spoken Luganda number words,
 * built compositionally from a native speaker's confirmed reference table
 * rather than trusted to Sunbird's own number translation — that turned out
 * to be unreliable (e.g. mistranslating "sixteen thousand" to a phrase that
 * actually means 160,000) where our own deterministic table is correct by
 * construction for every amount. Validated against the reference table
 * (Book1.xlsx, in this session's history) and against direct native-speaker
 * confirmation of several specific values (1,500 / 16,000 / 16,500 /
 * 36,500 / 62,500 among them) before being wired into the app.
 */

const UNITS: Record<number, string> = {
  1: "emu", 2: "bbiri", 3: "ssatu", 4: "nnya", 5: "ttaano",
  6: "mukaaga", 7: "musanvu", 8: "munaana", 9: "mwenda",
};

const TENS: Record<number, string> = {
  1: "kumi", 2: "abiri", 3: "asatu", 4: "ana", 5: "ataano",
  6: "nkaaga", 7: "nsanvu", 8: "kinaana", 9: "kyenda",
};

// 11-19: "kumi n'X" before a vowel-initial unit (1-5), "kumi na X" before a
// consonant-initial one (6-9) — the same elision Sunbird itself produced.
const TEENS: Record<number, string> = {
  1: "kumi na emu", 2: "kumi na bbiri", 3: "kumi na ssatu", 4: "kumi na nnya", 5: "kumi na ttaano",
  6: "kumi na mukaaga", 7: "kumi na musanvu", 8: "kumi na munaana", 9: "kumi na mwenda",
};

const HUNDREDS: Record<number, string> = {
  1: "kikumi", 2: "bibiri", 3: "bisatu", 4: "bina", 5: "bitaano",
  6: "lukaaga", 7: "lusanvu", 8: "lunaana", 9: "lwenda",
};

// Standalone thousands (1,000-9,000). 2-5 take an "enkumi" prefix when
// spoken alone or as a remainder; 6-9 are their own irregular word with no
// prefix (confirmed directly: 16,000 is "omutwaalo gumu mu kakaaga", not
// "... mu enkumi kakaaga").
const THOUSANDS: Record<number, string> = {
  1: "lukumi", 2: "enkumi bbiri", 3: "enkumi ssatu", 4: "enkumi nnya", 5: "enkumi ttaano",
  6: "kakaaga", 7: "kasanvu", 8: "kanaana", 9: "kenda",
};

// How many omutwalo (ten-thousands) — a distinct numeral series from the
// thousands one above (e.g. 60,000 is "emitwaalo mukaaga", using the plain
// "mu-" form, not the "ka-" form thousands use for 6-9).
const TWALO_COUNT: Record<number, string> = {
  1: "gumu", 2: "ebiri", 3: "esatu", 4: "ena", 5: "etaano",
  6: "mukaaga", 7: "musanvu", 8: "munaana", 9: "mwenda",
};

function twoDigitWord(n: number): string | null {
  if (n === 0) return null;
  if (n < 10) return UNITS[n];
  if (n === 10) return "kumi";
  if (n < 20) return TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const rest = n % 10;
  return rest === 0 ? TENS[tens] : `${TENS[tens]} mu ${UNITS[rest]}`;
}

function threeDigitWord(n: number): string | null {
  if (n === 0) return null;
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);
  const restWord = twoDigitWord(rest);
  if (restWord) parts.push(restWord);
  return parts.join(" mu ");
}

/** Count of omutwalo, 1-99 (e.g. 16 -> "kkumi na mukaaga", confirmed
 * directly against 160,000 -> "emitwaalo kkumi na mukaaga"). */
function twaloCountWord(n: number): string {
  if (n === 1) return "gumu";
  if (n < 10) return TWALO_COUNT[n];
  if (n === 10) return "kkumi";
  if (n < 20) return `kkumi na ${TWALO_COUNT[n - 10]}`;
  const tens = Math.floor(n / 10);
  const rest = n % 10;
  return rest === 0 ? TENS[tens] : `${TENS[tens]} mu ${TWALO_COUNT[rest]}`;
}

/** `n` must be a positive integer (a shilling amount) — callers only ever
 * invoke this for a set price, never a zero/missing one. */
export function numberToLuganda(n: number): string {
  const twalos = Math.floor(n / 10000);
  const thousands = Math.floor((n % 10000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (twalos > 0) {
    parts.push(twalos === 1 ? "omutwaalo gumu" : `emitwaalo ${twaloCountWord(twalos)}`);
  }
  if (thousands > 0) parts.push(THOUSANDS[thousands]);
  const restWord = threeDigitWord(rest);
  if (restWord) parts.push(restWord);
  return parts.join(" mu ");
}
