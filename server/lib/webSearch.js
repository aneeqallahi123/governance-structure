"use strict";
const { client } = require("./groq");

/**
 * Web search via Groq compound models. The compound models run server-side
 * agentic web search inside Groq's infrastructure — no separate search key needed.
 * https://console.groq.com/docs/compound
 *
 * Multi-model strategy:
 *   1. groq/compound       — full compound model, tries first
 *   2. groq/compound-mini  — fallback if compound hits a rate/size limit
 *
 * Compound models only accept a single user message (no system role).
 * Keep the query short and self-contained.
 */

const COMPOUND_PRIMARY = process.env.GROQ_SEARCH_MODEL || "groq/compound";
const COMPOUND_FALLBACK = "groq/compound-mini";

// Compound models reject long inputs; keep well under the limit.
const MAX_QUERY_LENGTH = 300;

async function callCompound(model, query) {
  const completion = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: query }],
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

  return { answer, sources };
}

async function webSearch(rawQuery) {
  // Distil the query to a tight search phrase the compound model can handle.
  const query =
    (typeof rawQuery === "string" ? rawQuery : String(rawQuery))
      .trim()
      .slice(0, MAX_QUERY_LENGTH);

  // Wrap the bare query with brief context so the model searches correctly
  // without needing a system prompt (which compound models may reject).
  const searchPrompt =
    `Pakistan government: ${query}. ` +
    `Find: official name, mandate, current head/leadership, website, and key attached bodies. ` +
    `Cite sources.`;

  try {
    const result = await callCompound(COMPOUND_PRIMARY, searchPrompt);
    return { answer: result.answer, sources: dedupeSources(result.sources), model: COMPOUND_PRIMARY };
  } catch (primaryErr) {
    console.warn(`[webSearch] ${COMPOUND_PRIMARY} failed (${primaryErr.message}), falling back to ${COMPOUND_FALLBACK}`);
    try {
      const result = await callCompound(COMPOUND_FALLBACK, searchPrompt);
      return { answer: result.answer, sources: dedupeSources(result.sources), model: COMPOUND_FALLBACK };
    } catch (fallbackErr) {
      console.error(`[webSearch] both models failed. fallback error: ${fallbackErr.message}`);
      throw fallbackErr;
    }
  }
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
