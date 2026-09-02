"use strict";
require("dotenv").config();
const { createApp } = require("./server/app");

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`governance-structure server listening on :${PORT}`);
});
