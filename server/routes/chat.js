"use strict";
const express = require("express");
const { client, CHAT_MODEL } = require("../lib/groq");
const { getToolDefs, executeTool } = require("../lib/tools");

const router = express.Router();

function buildSystemPrompt(webSearchEnabled) {
  return `You are the assistant embedded in an interactive map of Pakistan's federal and provincial \
government structure. You help the user in these ways:

1. Answer questions about the existing structure (ministries, divisions, departments, authorities, leadership, \
descriptions) using the search_structure / get_node / list_children tools. Always look the data up with tools \
rather than guessing — the visible map may have been edited since your training data.
2. Make changes to the structure when asked (e.g. "add a new Department of Climate Change under the Punjab \
government", "rename X to Y", "remove the defunct Z authority"). Use add_node / update_node / delete_node.
${
  webSearchEnabled
    ? "3. Use web_search for anything not covered by the structure data — current officeholders, recent news, " +
      "general questions — and cite sources briefly."
    : "3. Web search is turned OFF for this conversation. If a question needs live/current information you don't " +
      "have from the structure data or your own knowledge, say so plainly and suggest the user turn web search " +
      "back on, rather than guessing or fabricating an answer."
}

When asked to add something, work fast and decisively, in as few tool calls as possible:
- Call search_structure ONCE with the most distinctive keywords (e.g. the sector or the name of the likely \
parent body, not the new node's own name) to find candidate parents.
- Pick the single best-fitting parent from those results — the most specific existing body that would plausibly \
oversee it (e.g. a provincial "Information & Culture" or "Planning & Development" department, or the top-level \
provincial/federal government node if nothing more specific fits). Do not keep re-searching to find a "perfect" \
match; a reasonable, defensible parent is enough.
- Then immediately call add_node under that parent in the same turn. Do not call get_node or list_children first \
unless you genuinely need more detail to decide between two close candidates.
- Only ask the user a clarifying question if the request is genuinely ambiguous about WHICH existing node it \
should attach to among multiple very different plausible parents (e.g. federal vs. provincial) — never merely to \
double-check a reasonable guess.
For destructive changes (delete_node) make sure the request is unambiguous before acting; if it's ambiguous, ask \
one clarifying question instead of guessing.

Keep replies concise and conversational (a few sentences, occasional short bullet list). When you change the \
structure, say plainly what you changed and under which parent. Never fabricate node keys, names or facts — look \
them up.`;
}

const MAX_TOOL_ITERATIONS = 8;
const MAX_HISTORY_MESSAGES = 20;

router.post("/", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: "GROQ_API_KEY is not configured on the server." });
    }

    const { message, history, webSearch: webSearchEnabled = true } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const cleanHistory = Array.isArray(history)
      ? history
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-MAX_HISTORY_MESSAGES)
          .map((m) => ({ role: m.role, content: m.content }))
      : [];

    const messages = [
      { role: "system", content: buildSystemPrompt(Boolean(webSearchEnabled)) },
      ...cleanHistory,
      { role: "user", content: message },
    ];

    const tools = getToolDefs(Boolean(webSearchEnabled));
    const ctx = { structureChanged: false, actions: [], sources: [], webSearchEnabled: Boolean(webSearchEnabled) };
    let finalContent = "";
    const seenCalls = new Set();
    let stalled = false;

    const requestId = Math.random().toString(36).slice(2, 8);
    let extraParams = /^openai\/gpt-oss/.test(CHAT_MODEL) ? { reasoning_effort: "low" } : {};

    async function createCompletion(payload) {
      try {
        return await client.chat.completions.create({ ...payload, ...extraParams });
      } catch (err) {
        if (Object.keys(extraParams).length && /unknown|unrecognized|invalid.*param/i.test(err.message || "")) {
          console.warn(`[chat ${requestId}] extra params rejected (${err.message}), retrying without them`);
          extraParams = {};
          return await client.chat.completions.create(payload);
        }
        throw err;
      }
    }

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const isLastIter = i === MAX_TOOL_ITERATIONS - 1;
      const completion = await createCompletion({
        model: CHAT_MODEL,
        messages,
        ...(isLastIter ? {} : { tools, tool_choice: "auto" }),
        temperature: 0.3,
      });

      const choice = completion.choices[0];
      const msg = choice.message;
      console.log(
        `[chat ${requestId}] iter ${i} finish_reason=${choice.finish_reason} tool_calls=${
          (msg.tool_calls || []).map((c) => c.function.name).join(",") || "none"
        }`
      );

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalContent = msg.content || "";
        break;
      }

      messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });

      for (const call of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        const callSignature = `${call.function.name}:${JSON.stringify(args)}`;
        if (seenCalls.has(callSignature)) {
          stalled = true;
        }
        seenCalls.add(callSignature);

        let result;
        try {
          result = await executeTool(call.function.name, args, ctx);
        } catch (err) {
          result = { error: err.message || String(err) };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }

      if (stalled) {
        messages.push({
          role: "user",
          content:
            "You've repeated a tool call. Stop searching and either call add_node/update_node/delete_node now " +
            "with your best judgement, or reply in plain text explaining what's blocking you.",
        });
      }
    }

    if (!finalContent) {
      // Ran out of iterations (or was told to stop) without a final text reply — force one, no tools.
      const wrapUp = await createCompletion({
        model: CHAT_MODEL,
        messages: messages.concat([
          {
            role: "user",
            content:
              "Reply now in plain text only, no tool calls. Summarize what you found or changed so far, or ask a " +
              "single clarifying question if you're stuck.",
          },
        ]),
        temperature: 0.3,
      });
      finalContent =
        wrapUp.choices[0]?.message?.content ||
        "I wasn't able to finish that in time — could you rephrase or narrow the request?";
    }

    res.json({
      reply: finalContent,
      structureChanged: ctx.structureChanged,
      actions: ctx.actions,
      sources: ctx.sources,
    });
  } catch (err) {
    console.error("[chat] error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

module.exports = router;
