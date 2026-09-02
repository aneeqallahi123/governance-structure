"use strict";
const fs = require("fs");
const path = require("path");

const DATA_PATH = process.env.STRUCTURE_DATA_PATH
  ? path.resolve(process.env.STRUCTURE_DATA_PATH)
  : path.join(__dirname, "..", "data", "structure.json");

const SEED_PATH = path.join(__dirname, "..", "data", "structure.json");

const VALID_CATS = ["root", "fed", "prov", "ai", "dept", "auth", "jud", "lg", "defunct"];

let data = null;
let flat = [];
let keyMap = new Map();

function slugify(name) {
  return String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "NODE";
}

function ensureUniqueKey(base) {
  let key = base;
  let n = 2;
  while (keyMap.has(key)) {
    key = `${base}_${n}`;
    n++;
  }
  return key;
}

function reindex() {
  flat = [];
  keyMap = new Map();
  function walk(node, parent, path) {
    node._parent = parent || null;
    node._path = path;
    flat.push(node);
    if (node.key) keyMap.set(node.key, node);
    (node.children || []).forEach((c) => walk(c, node, path.concat(node.name)));
  }
  if (data.federal) walk(data.federal, null, []);
  if (data.provincial) walk(data.provincial, null, []);
}

function load() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
      fs.copyFileSync(SEED_PATH, DATA_PATH);
    }
    data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (err) {
    console.error("[store] failed to load structure data, falling back to seed:", err.message);
    data = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  }
  reindex();
  return data;
}

function persist() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const tmp = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stripPrivate(data), null, 2));
  fs.renameSync(tmp, DATA_PATH);
}

function stripPrivate(node) {
  if (Array.isArray(node)) return node.map(stripPrivate);
  if (node && typeof node === "object") {
    const out = {};
    for (const k of Object.keys(node)) {
      if (k === "_parent" || k === "_path") continue;
      out[k] = stripPrivate(node[k]);
    }
    return out;
  }
  return node;
}

function getPublicData() {
  return stripPrivate(data);
}

function findNode(identifier) {
  if (!identifier) return null;
  const id = String(identifier).trim();
  if (keyMap.has(id)) return keyMap.get(id);
  const upper = id.toUpperCase();
  if (keyMap.has(upper)) return keyMap.get(upper);
  const byName = flat.find((n) => n.name && n.name.toLowerCase() === id.toLowerCase());
  if (byName) return byName;
  const byAbbr = flat.find((n) => n.abbr && n.abbr.toLowerCase() === id.toLowerCase());
  if (byAbbr) return byAbbr;
  return null;
}

function nodePath(node) {
  return (node._path || []).concat(node.name).join(" > ");
}

function summarize(node) {
  return {
    key: node.key || null,
    name: node.name,
    abbr: node.abbr || null,
    cat: node.cat,
    path: nodePath(node),
    childCount: (node.children || []).length,
    desc: node.desc || null,
  };
}

function detail(node) {
  return {
    ...summarize(node),
    site: node.site || null,
    leads: node.leads || [],
    children: (node.children || []).map((c) => ({ key: c.key || null, name: c.name, cat: c.cat })),
  };
}

function search(query, limit = 10) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = flat
    .filter((n) => n.cat !== "root")
    .map((n) => {
      const hay = [n.name, n.abbr, n.desc, n.key, (n.leads || []).join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (n.name && n.name.toLowerCase().includes(t)) score += 5;
        if (n.abbr && n.abbr.toLowerCase() === t) score += 6;
        if (n.key && n.key.toLowerCase() === t) score += 6;
        if (hay.includes(t)) score += 1;
      }
      return { n, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((x) => summarize(x.n));
}

function addNode({ parentIdentifier, name, cat, desc, abbr, site, leads, key }) {
  const parent = findNode(parentIdentifier);
  if (!parent) throw new Error(`Parent node not found: "${parentIdentifier}"`);
  if (!name || !String(name).trim()) throw new Error("name is required");
  const finalCat = VALID_CATS.includes(cat) ? cat : "dept";
  if (finalCat === "root") throw new Error('cat "root" is reserved for the tree roots');
  const baseKey = slugify(key || name);
  const finalKey = ensureUniqueKey(baseKey);
  const node = {
    name: String(name).trim(),
    cat: finalCat,
    key: finalKey,
    expanded: false,
  };
  if (abbr) node.abbr = String(abbr).trim();
  if (desc) node.desc = String(desc).trim();
  if (site) node.site = String(site).trim();
  if (Array.isArray(leads) && leads.length) node.leads = leads.map(String);
  parent.children = parent.children || [];
  parent.children.push(node);
  parent.expanded = true;
  reindex();
  persist();
  return detail(node);
}

function updateNode(identifier, fields) {
  const node = findNode(identifier);
  if (!node) throw new Error(`Node not found: "${identifier}"`);
  if (node.cat === "root") throw new Error("cannot edit a root tree node");
  const editable = ["name", "desc", "abbr", "site", "leads", "cat"];
  for (const f of editable) {
    if (fields[f] === undefined) continue;
    if (f === "cat" && !VALID_CATS.includes(fields.cat)) continue;
    if (f === "cat" && fields.cat === "root") continue;
    node[f] = fields[f];
  }
  reindex();
  persist();
  return detail(node);
}

function deleteNode(identifier) {
  const node = findNode(identifier);
  if (!node) throw new Error(`Node not found: "${identifier}"`);
  if (node.cat === "root" || !node._parent) throw new Error("cannot delete a root tree");
  const parent = node._parent;
  const before = parent.children.length;
  parent.children = (parent.children || []).filter((c) => c !== node);
  if (parent.children.length === before) throw new Error("node was not a direct child of its recorded parent");
  const removedSummary = summarize(node);
  reindex();
  persist();
  return removedSummary;
}

function listChildren(identifier) {
  const node = findNode(identifier);
  if (!node) throw new Error(`Node not found: "${identifier}"`);
  return {
    node: summarize(node),
    children: (node.children || []).map(summarize),
  };
}

function resetToSeed() {
  data = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  reindex();
  persist();
  return getPublicData();
}

load();

module.exports = {
  load,
  persist,
  getPublicData,
  findNode,
  detail,
  summarize,
  search,
  addNode,
  updateNode,
  deleteNode,
  listChildren,
  resetToSeed,
  VALID_CATS,
};
