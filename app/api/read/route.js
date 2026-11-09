import Anthropic from "@anthropic-ai/sdk";
import { PROMPT } from "../../../lib/prompt.js";

export const runtime = "nodejs";
export const maxDuration = 60;

function authError(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return Response.json({ error: "APP_PASSWORD is not set on the server" }, { status: 500 });
  if (req.headers.get("x-app-password") !== pw) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

function parseRows(text) {
  text = text.trim().replace(/^```(?:json)?|```$/gm, "").trim();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    let a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0) { a = text.indexOf("["); b = text.lastIndexOf("]"); }
    data = JSON.parse(text.slice(a, b + 1));
  }
  return Array.isArray(data) ? data : data.rows ?? [];
}

export async function POST(req) {
  const bad = authError(req);
  if (bad) return bad;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server" }, { status: 500 });

  const { image, temperature } = await req.json();
  if (!image) return Response.json({ error: "no image" }, { status: 400 });

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const params = {
    model,
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
        { type: "text", text: PROMPT },
      ],
    }],
  };

  try {
    let msg;
    try {
      msg = await client.messages.create(temperature ? { ...params, temperature } : params);
    } catch (e) {
      if (temperature && /temperature/i.test(String(e?.message))) msg = await client.messages.create(params);
      else throw e;
    }
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return Response.json({ rows: parseRows(text) });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
