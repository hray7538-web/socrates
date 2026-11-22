// 소크라테스 — 되묻는 대화 상대. 웹 페이지 하나와 이 서버 하나.
// 켜기: ./켜기.sh  (열쇠는 ~/열쇠/열쇠.env 의 ANTHROPIC_API_KEY 를 읽는다. 값은 찍지 않는다.)
//
// 고를 수 있는 것(환경 변수):
//   PORT=7970  HOST=127.0.0.1
//   SOCRATES_PASSWORD=...   있으면 처음 한 번 문 비밀번호를 묻는다(다른 사람에게 열 때).
//   SOCRATES_EFFORT=medium  low | medium | high  (생각의 깊이. 높을수록 느리고 비싸다)
//   SOCRATES_DATA=./data    대화가 쌓이는 곳

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7970);
const HOST = process.env.HOST || "127.0.0.1";
const DATA = path.resolve(process.env.SOCRATES_DATA || path.join(here, "data"));
const PASSWORD = process.env.SOCRATES_PASSWORD || "";
const EFFORT = process.env.SOCRATES_EFFORT || "medium";
const MODEL = "claude-opus-5-5";

const MAX_TEXT = 4000;      // 한 번에 보낼 수 있는 글자 수
const MAX_MESSAGES = 300;   // 한 문답에 쌓일 수 있는 말의 수(사람 말 + 소크라테스 말)

fs.mkdirSync(DATA, { recursive: true });
const SYSTEM = fs.readFileSync(path.join(here, "소크라테스.md"), "utf8");
const INDEX = path.join(here, "public", "index.html");

const client = new Anthropic();

// ── 문(비밀번호) ─────────────────────────────────────────────
// 비밀번호가 있으면, 맞힌 브라우저에 서명된 쿠키를 준다.
const doorSecret = PASSWORD
  ? crypto.createHash("sha256").update("socrates-door:" + PASSWORD).digest()
  : null;
const doorToken = doorSecret
  ? crypto.createHmac("sha256", doorSecret).update("open").digest("hex")
  : "";

function doorOpen(req) {
  if (!PASSWORD) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)socrates_door=([a-f0-9]+)/);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(doorToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── 대화 저장 ────────────────────────────────────────────────
// data/<id>.json = { id, created, updated, history: MessageParam[], view: [{role, text}] }
// history 는 Claude 에게 그대로 다시 보내는 것(생각 블록까지 바꾸지 않고 둔다).
// view 는 화면에 보여 줄 글.
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function convPath(id) {
  return path.join(DATA, id + ".json");
}

function loadConv(id) {
  try {
    return JSON.parse(fs.readFileSync(convPath(id), "utf8"));
  } catch {
    const now = new Date().toISOString();
    return { id, created: now, updated: now, history: [], view: [] };
  }
}

function saveConv(conv) {
  conv.updated = new Date().toISOString();
  const tmp = convPath(conv.id) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(conv, null, 1));
  fs.renameSync(tmp, convPath(conv.id));
}

function logUsage(id, msg, ms) {
  const u = msg.usage || {};
  const line = JSON.stringify({
    at: new Date().toISOString(),
    id,
    model: msg.model,
    stop: msg.stop_reason,
    ms,
    in: u.input_tokens,
    out: u.output_tokens,
    cache_read: u.cache_read_input_tokens,
    cache_write: u.cache_creation_input_tokens,
  });
  fs.appendFileSync(path.join(DATA, "쓴것.jsonl"), line + "\n");
}

// 중간에 다른 모델로 넘겨졌으면(fallback), 마지막 fallback 블록 앞의 생각 · 도구 블록은 다시 보내지 않는다.
function contentToKeep(content) {
  let last = -1;
  content.forEach((b, i) => { if (b.type === "fallback") last = i; });
  if (last < 0) return content;
  const drop = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
  return content.filter((b, i) => i > last || !drop.has(b.type));
}

// ── 한 번의 문답 ─────────────────────────────────────────────
const busy = new Set();

async function chat(req, res, body) {
  const id = String(body.id || "");
  const text = String(body.text || "").trim();
  if (!ID_RE.test(id)) return sendJson(res, 400, { error: "문답 번호가 이상하네." });
  if (!text) return sendJson(res, 400, { error: "할 말이 비어 있네." });
  if (text.length > MAX_TEXT) return sendJson(res, 400, { error: `한 번에 ${MAX_TEXT}자까지만 받을 수 있네.` });
  if (busy.has(id)) return sendJson(res, 409, { error: "아직 앞의 말에 답하는 중이네." });

  const conv = loadConv(id);
  if (conv.history.length >= MAX_MESSAGES) {
    return sendJson(res, 400, { error: "이 문답은 꽤 길어졌네. 새 문답을 열어 주게." });
  }

  busy.add(id);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  const send = (o) => res.write(JSON.stringify(o) + "\n");

  const messages = [...conv.history, { role: "user", content: text }];
  const started = Date.now();
  let aborted = false;
  req.on("close", () => { if (!res.writableEnded) aborted = true; });

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT },
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      messages,
    });

    for await (const event of stream) {
      if (aborted) { stream.abort(); break; }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send({ type: "text", text: event.delta.text });
      }
    }
    if (aborted) return;

    const final = await stream.finalMessage();
    logUsage(id, final, Date.now() - started);

    if (final.stop_reason === "refusal") {
      send({ type: "error", message: "이 물음에는 내가 답을 이어 가지 못하겠네. 다르게 말해 주겠나?", discard: true });
      return;
    }

    const reply = final.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    conv.history = [...messages, { role: "assistant", content: contentToKeep(final.content) }];
    conv.view.push({ role: "user", text }, { role: "assistant", text: reply });
    saveConv(conv);
    send({ type: "done" });
  } catch (err) {
    console.error("[chat]", id, err?.constructor?.name, err?.status, err?.message);
    let message = "잠시 생각이 끊겼네. 조금 뒤에 다시 말해 주게.";
    if (err instanceof Anthropic.RateLimitError) message = "지금 찾아온 사람이 많네. 잠시 뒤에 다시 말해 주게.";
    else if (err instanceof Anthropic.AuthenticationError) message = "서버의 열쇠가 맞지 않네. 관리하는 사람에게 알려 주게.";
    else if (err instanceof Anthropic.BadRequestError) message = "말을 전하는 데 문제가 생겼네. 새 문답을 열어 보게.";
    send({ type: "error", message, discard: true });
  } finally {
    busy.delete(id);
    res.end();
  }
}

// ── 작은 도우미 ──────────────────────────────────────────────
function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error("too big")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// ── 길 ───────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  try {
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return fs.createReadStream(INDEX).pipe(res);
    }

    if (p === "/api/door") {
      if (req.method === "GET") return sendJson(res, 200, { open: doorOpen(req), needed: !!PASSWORD });
      if (req.method === "POST") {
        const body = await readBody(req);
        const given = Buffer.from(String(body.password || ""));
        const want = Buffer.from(PASSWORD);
        const ok = PASSWORD && given.length === want.length && crypto.timingSafeEqual(given, want);
        if (!ok) return sendJson(res, 403, { error: "비밀번호가 맞지 않네." });
        const secure = (req.headers["x-forwarded-proto"] || "") === "https" ? "; Secure" : "";
        return sendJson(res, 200, { open: true }, {
          "Set-Cookie": `socrates_door=${doorToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}${secure}`,
        });
      }
    }

    if (p.startsWith("/api/") && !doorOpen(req)) return sendJson(res, 401, { error: "문이 닫혀 있네." });

    if (req.method === "GET" && p.startsWith("/api/conversations/")) {
      const id = decodeURIComponent(p.slice("/api/conversations/".length));
      if (!ID_RE.test(id)) return sendJson(res, 400, { error: "문답 번호가 이상하네." });
      const conv = loadConv(id);
      return sendJson(res, 200, { id, view: conv.view, updated: conv.updated });
    }

    if (req.method === "POST" && p === "/api/chat") {
      const body = await readBody(req);
      return chat(req, res, body);
    }

    sendJson(res, 404, { error: "그런 길은 없네." });
  } catch (err) {
    console.error("[server]", err?.message);
    if (!res.headersSent) sendJson(res, 500, { error: "서버에 문제가 생겼네." });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`소크라테스: http://${HOST}:${PORT}  (모델 ${MODEL}, 생각 ${EFFORT}, 문 ${PASSWORD ? "있음" : "없음"})`);
});
