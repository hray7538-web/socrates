// 켜는 법: npm test  (열쇠도 서버도 필요 없다)
import test from "node:test";
import assert from "node:assert/strict";
import { messagesFor, mindChanged, withoutThinking } from "../history.mjs";

const thinking = { type: "thinking", thinking: "…", signature: "판1에묶임" };
const said = { type: "text", text: "자네가 말하는 기억이란 무엇인가?" };
const conv = () => ({
  history: [
    { role: "user", content: "기억이란 무엇일까?" },
    { role: "assistant", content: [thinking, said] },
  ],
  view: [{ role: "user", text: "기억이란 무엇일까?" }, { role: "assistant", text: said.text }],
  minds: [null, 1],
});

test("마음이 그대로면 지난 말을 손대지 않고 보낸다", () => {
  const c = conv();
  const m = messagesFor(c, 1, "있었던 일");
  assert.equal(mindChanged(c, 1), false);
  assert.deepEqual(m[1].content, [thinking, said]);
  assert.deepEqual(m.at(-1), { role: "user", content: "있었던 일" });
});

test("문답 도중 마음의 판이 바뀌면 옛 생각 블록을 빼고 말만 보낸다 (11/24 의 400)", () => {
  const c = conv();
  const m = messagesFor(c, 2, "다른 무엇이지 않은가");
  assert.equal(mindChanged(c, 2), true);
  assert.deepEqual(m[1].content, [said]);
  assert.equal(JSON.stringify(m).includes("signature"), false);
  assert.equal(m.length, 3);
  assert.deepEqual(c.history[1].content, [thinking, said], "쌓인 기록은 바꾸지 않는다");
});

test("판이 바뀐 뒤 새 판으로 답한 생각 블록도 다음 차례에 빠진다", () => {
  const c = conv();
  c.history.push({ role: "user", content: "다른 무엇" }, { role: "assistant", content: [{ type: "thinking", thinking: "…", signature: "판2에묶임" }, said] });
  c.minds.push(null, 2);
  const m = messagesFor(c, 2, "기억");
  assert.equal(JSON.stringify(m).includes("signature"), false);
});

test("새 문답과 옛 꼴의 기록에도 서 있다", () => {
  assert.deepEqual(messagesFor({ history: [] }, 2, "안녕"), [{ role: "user", content: "안녕" }]);
  assert.deepEqual(withoutThinking([{ role: "assistant", content: "글" }, { role: "assistant", content: [thinking] }]),
    [{ role: "assistant", content: "글" }, { role: "assistant", content: [thinking] }]);
});
