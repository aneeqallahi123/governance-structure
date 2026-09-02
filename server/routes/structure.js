"use strict";
const express = require("express");
const store = require("../lib/store");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(store.getPublicData());
});

router.get("/search", (req, res) => {
  const { q, limit } = req.query;
  res.json({ results: store.search(q, limit ? Number(limit) : 10) });
});

router.get("/node/:identifier", (req, res) => {
  const node = store.findNode(req.params.identifier);
  if (!node) return res.status(404).json({ error: "not found" });
  res.json(store.detail(node));
});

module.exports = router;
