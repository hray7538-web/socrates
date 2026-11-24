// Claude 에게 다시 보낼 지난 말을 고른다. server.mjs 의 chat 이 쓴다.
// 문답 도중에 마음의 판이 바뀌면, 옛 판으로 한 생각 블록은 새 마음과 함께 보낼 수 없다(400, 11/24 에 실제로 났다).
// 그때는 지난 답의 생각 블록을 빼고 말만 이어 보낸다.

export function withoutThinking(history) {
  return history.map((m) => {
    if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
    const kept = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
    return kept.length ? { ...m, content: kept } : m;
  });
}

// conv.minds[i] = view[i] 의 답을 할 때 쓴 마음의 판(사람 말 자리는 비어 있다).
export function mindChanged(conv, v) {
  return (conv.minds || []).some((x) => x != null && x !== v);
}

export function messagesFor(conv, v, text) {
  const past = mindChanged(conv, v) ? withoutThinking(conv.history) : conv.history;
  return [...past, { role: "user", content: text }];
}
