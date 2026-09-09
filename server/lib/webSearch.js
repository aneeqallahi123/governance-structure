"use strict";
const { client, SEARCH_MODEL } = require("./groq");

/**
 * Web search implemented via Groq's "compound" system models, which run
 * server-side agentic tool use (web search + page visits) inside Groq's
 * infrastructure. This means the whole app only needs the one GROQ_API_KEY
 * — no separate search API key to provision.
 * https://console.groq.com/docs/compound
 */
// Groq compound models reject queries over ~500 chars; trim to a safe limit.
const MAX_QUERY_LENGTH = 400;

async function webSearch(query) {
  const safeQuery = typeof query === "string" ? query.slice(0, MAX_QUERY_LENGTH) : String(query).slice(0, MAX_QUERY_LENGTH);
  const completion = await client.chat.completions.create({
    model: SEARCH_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "system",
        content:
          "You are a focused research assistant. Use web search to answer the user's query " +
          "with current, accurate information. Report what you find — do not hedge or refuse if sources exist. " +
          "List the concrete facts found (name, mandate, leadership, website) in under 300 words. " +
          "This is used to look up Pakistani federal/provincial government bodies; " +
          "prefer official government portals, gazette notifications, and reputable news sources.",
      },
      { role: "user", content: safeQuery },
    ],
  });

  const choice = completion.choices?.[0];
  const answer = choice?.message?.content || "";
  const executedTools = choice?.message?.executed_tools || completion.executed_tools || [];

  const sources = [];
  for (const t of executedTools) {
    const results = t?.search_results?.results || t?.output?.results || [];
    for (const r of results) {
      if (r?.url) sources.push({ title: r.title || r.url, url: r.url });
    }
  }

  return { answer, sources: dedupeSources(sources) };
}

function dedupeSources(sources) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out.slice(0, 8);
}

module.exports = { webSearch };
