"use strict";
const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const chatRouter = require("./routes/chat");
const structureRouter = require("./routes/structure");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many chat requests, please slow down." },
  });

  app.use("/api/chat", chatLimiter, chatRouter);
  app.use("/api/structure", structureRouter);

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, groqConfigured: Boolean(process.env.GROQ_API_KEY) });
  });

  const staticRoot = path.join(__dirname, "..");
  app.use(express.static(staticRoot, { extensions: ["html"] }));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticRoot, "index.html"));
  });

  return app;
}

module.exports = { createApp };
