import ExcelJS from "exceljs";
import { TEMPLATE_B64 } from "../../../lib/template-b64.js";
import { plate } from "../../../lib/form.js";

export const runtime = "nodejs";
export const maxDuration = 30;

const FIRST_DATA_ROW = 5; // template: row 4 = code/date line, data from row 5
const YELLOW = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };

export async function POST(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return Response.json({ error: "APP_PASSWORD is not set on the server" }, { status: 500 });
  if (req.headers.get("x-app-password") !== pw) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { code, date, rows } = await req.json();
  const codeVal = /^\d+$/.test(String(code)) ? parseInt(code, 10) : code;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(TEMPLATE_B64, "base64"));
  const ws = wb.worksheets[0];

  const base = [];
  for (let c = 1; c <= 6; c++) base.push(JSON.parse(JSON.stringify(ws.getRow(FIRST_DATA_ROW).getCell(c).style || {})));

  const last = Math.max(ws.rowCount, FIRST_DATA_ROW + rows.length);
  for (let r = FIRST_DATA_ROW; r <= last; r++) {
    for (let c = 1; c <= 6; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.value = null;
      cell.style = JSON.parse(JSON.stringify(base[c - 1]));
    }
  }

  ws.getRow(FIRST_DATA_ROW - 1).getCell(4).value = codeVal;
  ws.getRow(FIRST_DATA_ROW - 1).getCell(5).value = date;

  rows.forEach((row, i) => {
    const wr = ws.getRow(FIRST_DATA_ROW + i);
    wr.getCell(1).value = i + 1;
    wr.getCell(2).value = plate(row);
    wr.getCell(3).value = row.liters || null;
    wr.getCell(4).value = codeVal;
    wr.getCell(5).value = date;
    if (row.flag) {
      wr.getCell(2).fill = YELLOW;
      wr.getCell(3).fill = YELLOW;
    }
    wr.commit();
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="fuel.xlsx"',
    },
  });
}
