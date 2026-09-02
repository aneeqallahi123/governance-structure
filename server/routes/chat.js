"use strict";
const express = require("express");
const { client, CHAT_MODEL } = require("../lib/groq");
const { toolDefs, executeTool } = require("../lib/tools");

const router = express.Router();

const SYSTEM_PROMPT = `You are the assistant embedded in an interactive map of Pakistan's federal and provincial \
government structure. You help the user in three ways:

1. Answer questions about the existing structure (ministries, divisions, departments, authorities, leadership, \
descriptions) using the search_structure / get_node / list_children tools. Always look the data up with tools \
rather than guessing — the visible map may have been edited since your training data.
2. Make changes to the structure when asked (e.g. "add a new Department of Climate Change under the Punjab \
government", "rename X to Y", "remove the defunct Z authority"). Use add_node / update_node / delete_node. \
Resolve the correct parent/node first with search_structure or get_node if you're not sure of its exact key. \
For destructive changes (delete_node) make sure the request is unambiguous before acting; if it's ambiguous, ask \
one clarifying question instead of guessing.
3. Use web_search for anything not covered by the structure data — current officeholders, recent news, general \
questions — and cite sources briefly.

Keep replies concise and conversational (a few sentences, occasional short bullet list). When you change the \
structure, say plainly what you changed. Never fabricate node keys, names or facts — look them up.`;

const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 20;

router.post("/", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: "GROQ_API_KEY is not configured on the server." });
    }

    const { message, history } = req.body || {};
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
      { role: "system", content: SYSTEM_PROMPT },
      ...cleanHistory,
      { role: "user", content: message },
    ];

    const ctx = { structureChanged: false, actions: [], sources: [] };
    let finalContent = "";

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const completion = await client.chat.completions.create({
        model: CHAT_MODEL,
        messages,
        tools: toolDefs,
        tool_choice: "auto",
        temperature: 0.3,
      });

      const choice = completion.choices[0];
      const msg = choice.message;

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

      if (i === MAX_TOOL_ITERATIONS - 1) {
        finalContent = "I made some changes but hit my step limit while responding — let me know if you'd like me to continue.";
      }
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
