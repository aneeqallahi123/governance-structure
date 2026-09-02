"use strict";
const store = require("./store");
const { webSearch } = require("./webSearch");

const toolDefs = [
  {
    type: "function",
    function: {
      name: "search_structure",
      description:
        "Search the governance structure (federal and provincial trees) by keyword. Matches names, " +
        "abbreviations, keys and descriptions. Use this first to find the key of a node before reading, " +
        "editing, or adding under it.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords, e.g. 'health department Punjab'" },
          limit: { type: "integer", description: "Max results, default 10", default: 10 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_node",
      description:
        "Get full details of a single node in the structure (description, leads, site, path, and its " +
        "immediate children) by its key, abbreviation, or exact name.",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Node key, abbreviation, or exact name" },
        },
        required: ["identifier"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_children",
      description: "List the immediate children of a node by key, abbreviation, or exact name.",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Node key, abbreviation, or exact name" },
        },
        required: ["identifier"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_node",
      description:
        "Add a new node (department, authority, division, unit, etc.) as a child of an existing node in the " +
        "structure. Always confirm the parent exists via search_structure/get_node first if you are not certain " +
        "of its key. This persists immediately and is reflected on the map.",
      parameters: {
        type: "object",
        properties: {
          parent: { type: "string", description: "Key, abbreviation, or exact name of the parent node" },
          name: { type: "string", description: "Name of the new node" },
          cat: {
            type: "string",
            enum: ["fed", "prov", "ai", "dept", "auth", "jud", "lg", "defunct"],
            description:
              "Category: fed=federal ministry/division, prov=provincial department, ai=Office of AI unit, " +
              "dept=department (generic, most common), auth=authority/attached unit, jud=judicial/oversight, " +
              "lg=local government, defunct=merged/defunct body.",
          },
          desc: { type: ["string", "null"], description: "1-3 sentence description of the body's mandate" },
          abbr: { type: ["string", "null"], description: "Short abbreviation, e.g. 'PITB'. Omit or null if none." },
          site: {
            type: ["string", "null"],
            description: "Official website domain, no protocol, e.g. 'pitb.gov.pk'. Omit or null if unknown.",
          },
          leads: {
            type: ["array", "null"],
            items: { type: "string" },
            description: "Leadership lines, e.g. ['Jane Doe — Secretary']. Omit or null if unknown.",
          },
        },
        required: ["parent", "name", "cat"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_node",
      description: "Update fields on an existing node (name, description, abbreviation, site, leads, or category).",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Key, abbreviation, or exact name of the node to update" },
          name: { type: ["string", "null"] },
          desc: { type: ["string", "null"] },
          abbr: { type: ["string", "null"] },
          site: { type: ["string", "null"] },
          leads: { type: ["array", "null"], items: { type: "string" } },
          cat: {
            type: ["string", "null"],
            enum: ["fed", "prov", "ai", "dept", "auth", "jud", "lg", "defunct", null],
          },
        },
        required: ["identifier"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_node",
      description:
        "Permanently remove a node (and everything under it) from the structure. Only use this when the user " +
        "explicitly confirms they want a node removed — this cannot be undone through the chat.",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Key, abbreviation, or exact name of the node to delete" },
        },
        required: ["identifier"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the live web for information not available in the governance structure data — e.g. current " +
        "office-holders, recent reorganizations, news about a ministry, or general factual questions. Returns a " +
        "concise answer plus source URLs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The web search query" },
        },
        required: ["query"],
      },
    },
  },
];

async function executeTool(name, args, ctx) {
  switch (name) {
    case "search_structure":
      return { results: store.search(args.query, args.limit || 10) };

    case "get_node": {
      const node = store.findNode(args.identifier);
      if (!node) return { error: `No node found matching "${args.identifier}"` };
      return store.detail(node);
    }

    case "list_children":
      return store.listChildren(args.identifier);

    case "add_node": {
      const result = store.addNode({
        parentIdentifier: args.parent,
        name: args.name,
        cat: args.cat,
        desc: args.desc,
        abbr: args.abbr,
        site: args.site,
        leads: args.leads,
      });
      ctx.structureChanged = true;
      ctx.actions.push({ type: "add_node", node: result });
      return result;
    }

    case "update_node": {
      const { identifier, ...fields } = args;
      const result = store.updateNode(identifier, fields);
      ctx.structureChanged = true;
      ctx.actions.push({ type: "update_node", node: result });
      return result;
    }

    case "delete_node": {
      const result = store.deleteNode(args.identifier);
      ctx.structureChanged = true;
      ctx.actions.push({ type: "delete_node", node: result });
      return result;
    }

    case "web_search": {
      const result = await webSearch(args.query);
      ctx.sources.push(...result.sources);
      return result;
    }

    default:
      return { error: `Unknown tool "${name}"` };
  }
}

module.exports = { toolDefs, executeTool };
