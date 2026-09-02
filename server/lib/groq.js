"use strict";
const Groq = require("groq-sdk");

if (!process.env.GROQ_API_KEY) {
  console.warn("[groq] GROQ_API_KEY is not set — chat endpoints will return an error until it is configured.");
}

// Fall back to a placeholder so the SDK doesn't throw at import time when the
// key isn't configured yet; routes check GROQ_API_KEY themselves before use.
const client = new Groq({ apiKey: process.env.GROQ_API_KEY || "unset" });

const CHAT_MODEL = process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";
const SEARCH_MODEL = process.env.GROQ_SEARCH_MODEL || "groq/compound-mini";

module.exports = { client, CHAT_MODEL, SEARCH_MODEL };
