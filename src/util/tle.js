import { twoline2satrec } from 'satellite.js';

/**
 * Parse a CelesTrak three-line element listing.
 *
 * Malformed or decayed entries are skipped rather than thrown on — a single
 * bad element set in an 11,000-line file should not cost you the whole layer.
 */
export function parseTle(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trimEnd());
  const out = [];

  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const name = lines[i]?.trim();
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!name || !l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue;
    try {
      const satrec = twoline2satrec(l1, l2);
      if (satrec.error) continue;
      out.push({
        name,
        noradId: l1.slice(2, 7).trim(),
        satrec,
        // Julian day -> epoch millis, for the freshness readout.
        epochMs: (satrec.jdsatepoch - 2440587.5) * 86_400_000,
        periodMin: Math.round((2 * Math.PI) / satrec.no),
      });
    } catch {
      /* skip this element set */
    }
  }
  return out;
}
