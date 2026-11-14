// Speech-to-text spells a company name the way it sounds ("Kala" for Cala). When the founder has
// typed the company name, words in the transcript that sound like it are rewritten to it.
//
// A word is corrected only when all of these hold:
//   - the name word and the transcript word are both at least 4 letters;
//   - the two are within Levenshtein distance 1–2 (so "calendar" is never touched);
//   - they collapse to the same sound key: c/ck→k, ph→f, doubled letters collapsed, every vowel
//     folded to one ("Kala", "Calla", "Kola" → Cala).
// A near-miss that does not sound alike stays as it is: "Cara" is distance 1 from "Cala" but r and
// l are different sounds, so it is left alone. Other words are never touched.

const MIN_LEN = 4;

function soundKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/c/g, "k")
    .replace(/[aeiouy]+/g, "a")
    .replace(/(.)\1+/g, "$1");
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function soundsLike(word: string, nameWord: string): boolean {
  if (word.length < MIN_LEN || nameWord.length < MIN_LEN) return false;
  const w = word.toLowerCase();
  const n = nameWord.toLowerCase();
  if (w === n) return false;
  const d = editDistance(w, n);
  if (d < 1 || d > 2) return false;
  return soundKey(w) === soundKey(n);
}

export function correctCompanyName(text: string, companyName: string): string {
  const nameWords = companyName.split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w));
  if (!text || !nameWords.length) return text;
  return text.replace(/[A-Za-z]+/g, (word) => {
    const hit = nameWords.find((n) => soundsLike(word, n));
    return hit ?? word;
  });
}
