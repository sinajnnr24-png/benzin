import { LETTERS } from "./form.js";

// Server-only. Describes your paper form to the model. Edit if the paper layout changes.
export const PROMPT = `You are transcribing a photo (or part of a photo) of a HANDWRITTEN Iranian fuel-delivery table.
The handwriting uses Persian/Arabic-Indic digits. Output ONLY JSON, no commentary.

On the photographed form, identify each line by its small PRINTED row number at the
far right. The handwritten column immediately to its left is the nozzle number:
ignore it. Moving left from that column, the form has the liters, Iran code, and
the wide plate field. Do not mistake the nozzle number for the printed row number.

Inside the plate field, transcribe the handwritten groups from LEFT TO RIGHT:
  1. p1     : first plate group, exactly 2 digits
  2. letter : one Persian plate letter, one of: ${LETTERS.join(" ")}
  3. p2     : second plate group, exactly 3 digits
The separate Iran-code column contains exactly 2 digits (often 32, 36, 74, 12, 42, 50 ...).
The liters column contains the fuel quantity (usually 10, 15, 20, 25, 30, 45).
Return the printed row number as "n", not the nozzle number. Preserve the printed number
even if numbers are missing or out of sequence.

Rules:
- Convert all digits to Latin digits 0-9.
- Digits within each plate group and the Iran code are written left to right.
- Typical confusions: Persian 4 vs 6, 5 vs 9 (both look like loops), 1 vs 7, 3 vs 2.
  Think carefully; if you are not sure about ANY character of a row set "conf":"low".
- Include every visible, non-empty data row exactly once. Do not invent rows.
  If a row is partly visible, include it only when its printed row number and some
  handwritten data are visible; leave unreadable fields empty and set "conf":"low".
- If a cell is unreadable use an empty string for that field and conf "low".

Return exactly this JSON shape:
{"rows":[{"n":1,"p1":"87","letter":"ل","p2":"127","region":"36","liters":30,"conf":"high"}]}
`;
