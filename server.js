"use strict";
require("dotenv").config();
const { createApp } = require("./server/app");

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`governance-structure server listening on :${PORT}`);
});

if (process.env.GROQ_API_KEY) {
  const { client } = require("./server/lib/groq");
  client.models
    .list()
    .then((res) => {
      console.log("[groq] available models:", (res.data || []).map((m) => m.id).join(", "));
    })
    .catch((err) => console.error("[groq] failed to list models:", err.message));
}
