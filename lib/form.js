// Shared logic (browser + server): form description, validation, merging.
// If your paper form changes, edit LETTERS / USUAL_LITERS here and the prompt in lib/prompt.js.

export const LETTERS = ["الف","ب","پ","ت","ث","ج","د","ز","ژ","س","ش","ص","ط","ع","ف","ق","ک","گ","ل","م","ن","و","ه","ی"];
export const USUAL_LITERS = new Set([10, 15, 20, 25, 30, 45, 60]);

export function digits(s) {
  return String(s ?? "")
    .replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c))
    .replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c))
    .replace(/\D/g, "");
}

export function normLetter(s) {
  s = String(s ?? "").trim().replace(/ي/g, "ی").replace(/ك/g, "ک");
  return ["ا", "آ", "الف"].includes(s) ? "الف" : s;
}

export function normRow(d) {
  if (!d || typeof d !== "object") return null;
  const n = digits(d.n);
  return {
    n: n ? parseInt(n, 10) : null,
    p1: digits(d.p1),
    letter: normLetter(d.letter),
    p2: digits(d.p2),
    region: digits(d.region),
    liters: parseInt(digits(d.liters) || "0", 10),
    low: String(d.conf ?? "high").toLowerCase() !== "high",
  };
}

export function problems(r) {
  const p = [];
  if (r.p1.length !== 2) p.push("دو رقم اول پلاک کامل نیست");
  if (!LETTERS.includes(r.letter)) p.push("حرف پلاک نامعتبر");
  if (r.p2.length !== 3) p.push("سه رقم پلاک کامل نیست");
  if (r.region.length !== 2) p.push("کد ایران کامل نیست");
  if (!USUAL_LITERS.has(r.liters)) p.push("لیتراژ غیرمعمول");
  if (r.low) p.push("مدل مطمئن نبود");
  return p;
}

export const plate = (r) => `${r.p1}${r.letter}${r.p2}-${r.region}`;

export const better = (a, b) => (problems(a).length <= problems(b).length ? a : b);

// passes: array of { [n]: row }  ->  [{row, reasons}] sorted by printed row number
export function combinePasses(passes) {
  const ns = [...new Set(passes.flatMap((p) => Object.keys(p).map(Number)))].sort((a, b) => a - b);
  return ns.map((n) => {
    const cands = passes.map((p) => p[n]).filter(Boolean);
    let best = cands[0];
    for (const c of cands.slice(1)) best = better(best, c);
    const reasons = problems(best);
    const sigs = new Set(cands.map((c) => `${plate(c)}/${c.liters}`));
    if (sigs.size > 1) reasons.push("خواندن‌ها با هم فرق داشتند: " + [...sigs].join(" | "));
    if (cands.length < passes.length) reasons.push("در یکی از دفعات خوانده نشد");
    return { row: best, reasons };
  });
}
