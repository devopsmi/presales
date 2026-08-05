import type { QuotationRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// TreeNode
// ---------------------------------------------------------------------------

export type NodeType = "module" | "sub_module" | "function" | "leaf";

export interface TreeNode {
  id: number;
  type: NodeType;
  name: string;
  description: string | null; // only for leaf nodes
  children: TreeNode[];
  category?: "feature" | "support"; // undefined treated as "feature"
}

// ---------------------------------------------------------------------------
// LevelRow — flattened view for prompt builders
// ---------------------------------------------------------------------------

export interface LevelRow {
  id: number;
  module: string;
  sub_module: string | null;
  function: string | null;
  sub_function: string | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// RoundChangeSet
// ---------------------------------------------------------------------------

export interface RoundChangeSet {
  affectedIds: Set<number>;
  affectedSubModules: Set<string>; // "module::sub_module"
  affectedFunctions: Set<string>;   // "module::sub_module::function"
}

function subKey(mod: string, sub: string): string { return `${mod}::${sub}`; }
function funcKey(mod: string, sub: string, fn: string): string { return `${mod}::${sub}::${fn}`; }

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

type L1Snap = Map<number, string>;                   // id → moduleName
type L2Snap = Map<number, { name: string; modName: string }>;
type L3Snap = Map<number, { name: string; modName: string; subName: string }>;
type L4Snap = Map<number, { name: string; description: string; modName: string; subName: string; funcName: string }>;

// ---------------------------------------------------------------------------
// DecomposerTree
// ---------------------------------------------------------------------------

export class DecomposerTree {
  private root: TreeNode[] = [];
  private nextId = 1;
  private idMap = new Map<number, TreeNode>();

  // -----------------------------------------------------------------------
  // Factory
  // -----------------------------------------------------------------------

  static fromPreviousRows(previousRows?: QuotationRow[]): DecomposerTree {
    const tree = new DecomposerTree();
    if (!previousRows?.length) return tree;

    const modCache = new Map<string, TreeNode>();
    const subCache = new Map<string, TreeNode>();
    const funcCache = new Map<string, TreeNode>();

    for (const row of previousRows) {
      // Detect old design placeholder rows: all 4 hierarchy levels equal
      const isOldDesign = row.module === row.sub_module &&
        row.sub_module === row.function &&
        row.function === row.sub_function;

      if (isOldDesign) {
        // Create support module with NO children
        let mod = modCache.get(row.module);
        if (!mod) {
          mod = { id: tree.nextId++, type: "module", name: row.module, description: row.description || row.module, children: [], category: "support" };
          tree.root.push(mod);
          tree.idMap.set(mod.id, mod);
          modCache.set(row.module, mod);
        }
        continue;
      }

      let mod = modCache.get(row.module);
      if (!mod) {
        mod = { id: tree.nextId++, type: "module", name: row.module, description: null, children: [] };
        tree.root.push(mod);
        tree.idMap.set(mod.id, mod);
        modCache.set(row.module, mod);
      }

      const subK = `${row.module}::${row.sub_module}`;
      let sub = subCache.get(subK);
      if (!sub) {
        sub = { id: tree.nextId++, type: "sub_module", name: row.sub_module, description: null, children: [] };
        mod.children.push(sub);
        tree.idMap.set(sub.id, sub);
        subCache.set(subK, sub);
      }

      const funcK = `${subK}::${row.function}`;
      let func = funcCache.get(funcK);
      if (!func) {
        func = { id: tree.nextId++, type: "function", name: row.function, description: null, children: [] };
        sub.children.push(func);
        tree.idMap.set(func.id, func);
        funcCache.set(funcK, func);
      }

      const leaf: TreeNode = {
        id: tree.nextId++,
        type: "leaf",
        name: row.sub_function,
        description: row.description,
        children: [],
      };
      func.children.push(leaf);
      tree.idMap.set(leaf.id, leaf);
    }

    return tree;
  }

  // -----------------------------------------------------------------------
  // Convert to QuotationRow[]
  // -----------------------------------------------------------------------

  toQuotationRows(): QuotationRow[] {
    const rows: QuotationRow[] = [];
    let seq = 0;

    const traverse = (
      node: TreeNode,
      modName: string,
      subName: string,
      funcName: string,
    ): void => {
      if (node.category === "support") {
        // Support node: emit ONE placeholder row, stop recursion
        const desc = node.description ?? node.name;
        switch (node.type) {
          case "module":
            rows.push({
              seq: ++seq, module: node.name, sub_module: node.name,
              function: node.name, sub_function: node.name, description: desc,
              trades: {}, remark: "",
            });
            return;
          case "sub_module":
            rows.push({
              seq: ++seq, module: modName, sub_module: node.name,
              function: node.name, sub_function: node.name, description: desc,
              trades: {}, remark: "",
            });
            return;
          case "function":
            rows.push({
              seq: ++seq, module: modName, sub_module: subName,
              function: node.name, sub_function: node.name, description: desc,
              trades: {}, remark: "",
            });
            return;
          case "leaf":
            rows.push({
              seq: ++seq, module: modName, sub_module: subName,
              function: funcName, sub_function: node.name, description: desc,
              trades: {}, remark: "",
            });
            return;
        }
      }

      // Feature leaf node: emit row
      if (node.type === "leaf") {
        rows.push({
          seq: ++seq,
          module: modName,
          sub_module: subName,
          function: funcName,
          sub_function: node.name,
          description: node.description ?? "",
          trades: {},
          remark: "",
        });
        return;
      }

      // Feature interior node: recurse into children
      for (const child of node.children) {
        if (node.type === "module") {
          traverse(child, node.name, "", "");
        } else if (node.type === "sub_module") {
          traverse(child, modName, node.name, "");
        } else if (node.type === "function") {
          traverse(child, modName, subName, node.name);
        }
      }
    };

    for (const mod of this.root) {
      traverse(mod, mod.name, "", "");
    }

    return rows;
  }

  // -----------------------------------------------------------------------
  // Node lookup
  // -----------------------------------------------------------------------

  getNode(id: number): TreeNode | undefined {
    return this.idMap.get(id);
  }

  // -----------------------------------------------------------------------
  // Level-scoped flattened views
  // -----------------------------------------------------------------------

  /** Get all module nodes (level 1), filtering out support modules. */
  getModules(): TreeNode[] {
    return this.root.filter((m) => m.category !== "support");
  }

  getModuleNames(): string[] {
    return this.root.filter((m) => m.category !== "support").map((m) => m.name);
  }

  getSubModulePairs(): { module: string; sub_module: string }[] {
    const pairs: { module: string; sub_module: string }[] = [];
    for (const mod of this.root) {
      if (mod.category === "support") continue;
      for (const sub of mod.children) {
        if (sub.category === "support") continue;
        pairs.push({ module: mod.name, sub_module: sub.name });
      }
    }
    return pairs;
  }

  /** Flatten nodes at level for prompt display. Skips support nodes. */
  getRowsAtLevel(level: number): LevelRow[] {
    const rows: LevelRow[] = [];

    if (level === 1) {
      for (const mod of this.root) {
        if (mod.category === "support") continue;
        rows.push({ id: mod.id, module: mod.name, sub_module: null, function: null, sub_function: null, description: null });
      }
      return rows;
    }

    for (const mod of this.root) {
      if (mod.category === "support") continue;
      if (level === 2) {
        for (const sub of mod.children) {
          if (sub.category === "support") continue;
          rows.push({ id: sub.id, module: mod.name, sub_module: sub.name, function: null, sub_function: null, description: null });
        }
      } else if (level === 3) {
        for (const sub of mod.children) {
          if (sub.category === "support") continue;
          for (const func of sub.children) {
            if (func.category === "support") continue;
            rows.push({ id: func.id, module: mod.name, sub_module: sub.name, function: func.name, sub_function: null, description: null });
          }
        }
      } else if (level === 4) {
        for (const sub of mod.children) {
          if (sub.category === "support") continue;
          for (const func of sub.children) {
            if (func.category === "support") continue;
            for (const leaf of func.children) {
              if (leaf.category === "support") continue;
              rows.push({ id: leaf.id, module: mod.name, sub_module: sub.name, function: func.name, sub_function: leaf.name, description: leaf.description });
            }
          }
        }
      }
    }

    return rows;
  }

  /**
   * For R3 pruning: return sub_module rows (level 2) whose (module, sub_module)
   * key is in the parent changeset.
   */
  getRowsAtLevelPruned(level: number, changes: RoundChangeSet): LevelRow[] {
    if (level !== 3) return [];

    const rows: LevelRow[] = [];
    for (const mod of this.root) {
      if (mod.category === "support") continue;
      for (const sub of mod.children) {
        if (sub.category === "support") continue;
        if (!changes.affectedSubModules.has(subKey(mod.name, sub.name))) continue;
        rows.push({ id: sub.id, module: mod.name, sub_module: sub.name, function: null, sub_function: null, description: null });
      }
    }
    return rows;
  }

  /**
   * For R4 pruning: return function-level rows (level 3) whose
   * (module, sub_module, function) key is in the function filter.
   */
  getRowsForSubModule(
    module: string,
    subModule: string,
    prunedFunctionKeys?: Set<string>,
  ): LevelRow[] {
    const mod = this.root.find((m) => m.name === module);
    if (!mod) return [];
    const sub = mod.children.find((s) => s.name === subModule);
    if (!sub) return [];

    const rows: LevelRow[] = [];
    for (const func of sub.children) {
      if (func.category === "support") continue;
      if (prunedFunctionKeys && !prunedFunctionKeys.has(funcKey(module, subModule, func.name))) continue;
      rows.push({ id: func.id, module, sub_module: subModule, function: func.name, sub_function: null, description: null });
      // Also include existing leaf rows under this function
      for (const leaf of func.children) {
        if (leaf.category === "support") continue;
        rows.push({ id: leaf.id, module, sub_module: subModule, function: func.name, sub_function: leaf.name, description: leaf.description });
      }
    }
    return rows;
  }

  groupBySubModule(rows: LevelRow[]): Map<string, { module: string; subModule: string; rows: LevelRow[] }> {
    const map = new Map<string, { module: string; subModule: string; rows: LevelRow[] }>();
    for (const r of rows) {
      const key = subKey(r.module, r.sub_module!);
      let entry = map.get(key);
      if (!entry) {
        entry = { module: r.module, subModule: r.sub_module!, rows: [] };
        map.set(key, entry);
      }
      entry.rows.push(r);
    }
    return map;
  }

  // -----------------------------------------------------------------------
  // R1 CRUD
  // -----------------------------------------------------------------------

  addModules(names: string[]): number[] {
    const ids: number[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      if (this.root.some((m) => m.name === trimmed)) continue;
      const node: TreeNode = { id: this.nextId++, type: "module", name: trimmed, description: null, children: [] };
      this.root.push(node);
      this.idMap.set(node.id, node);
      ids.push(node.id);
    }
    return ids;
  }

  deleteModules(names: string[]): void {
    for (const name of names) {
      const trimmed = name.trim();
      const idx = this.root.findIndex((m) => m.name === trimmed);
      if (idx === -1) continue;
      this.removeNode(this.root[idx]);
      this.root.splice(idx, 1);
    }
  }

  renameModule(oldName: string, newName: string): void {
    const mod = this.root.find((m) => m.name === oldName);
    if (!mod) throw new Error(`Module "${oldName}" not found`);
    mod.name = newName.trim();
  }

  // -----------------------------------------------------------------------
  // R2 CRUD
  // -----------------------------------------------------------------------

  addSubModules(moduleName: string, names: string[]): number[] {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) throw new Error(`Module "${moduleName}" not found`);
    const ids: number[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      if (mod.children.some((s) => s.name === trimmed)) continue;
      const node: TreeNode = { id: this.nextId++, type: "sub_module", name: trimmed, description: null, children: [] };
      mod.children.push(node);
      this.idMap.set(node.id, node);
      ids.push(node.id);
    }
    return ids;
  }

  deleteSubModules(moduleName: string, names: string[]): void {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) return;
    for (const name of names) {
      const trimmed = name.trim();
      const idx = mod.children.findIndex((s) => s.name === trimmed);
      if (idx === -1) continue;
      this.removeNode(mod.children[idx]);
      mod.children.splice(idx, 1);
    }
  }

  renameSubModule(moduleName: string, oldName: string, newName: string): void {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) throw new Error(`Module "${moduleName}" not found`);
    const sub = mod.children.find((s) => s.name === oldName);
    if (!sub) throw new Error(`Sub-module "${oldName}" not found in module "${moduleName}"`);
    sub.name = newName.trim();
  }

  // -----------------------------------------------------------------------
  // R3 CRUD
  // -----------------------------------------------------------------------

  addFunctions(moduleName: string, subName: string, names: string[]): number[] {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) throw new Error(`Module "${moduleName}" not found`);
    const sub = mod.children.find((s) => s.name === subName);
    if (!sub) throw new Error(`Sub-module "${subName}" not found in module "${moduleName}"`);
    const ids: number[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      if (sub.children.some((f) => f.name === trimmed)) continue;
      const node: TreeNode = { id: this.nextId++, type: "function", name: trimmed, description: null, children: [] };
      sub.children.push(node);
      this.idMap.set(node.id, node);
      ids.push(node.id);
    }
    return ids;
  }

  deleteFunctions(moduleName: string, subName: string, names: string[]): void {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) return;
    const sub = mod.children.find((s) => s.name === subName);
    if (!sub) return;
    for (const name of names) {
      const trimmed = name.trim();
      const idx = sub.children.findIndex((f) => f.name === trimmed);
      if (idx === -1) continue;
      this.removeNode(sub.children[idx]);
      sub.children.splice(idx, 1);
    }
  }

  renameFunction(moduleName: string, subName: string, oldName: string, newName: string): void {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) throw new Error(`Module "${moduleName}" not found`);
    const sub = mod.children.find((s) => s.name === subName);
    if (!sub) throw new Error(`Sub-module "${subName}" not found`);
    const func = sub.children.find((f) => f.name === oldName);
    if (!func) throw new Error(`Function "${oldName}" not found`);
    func.name = newName.trim();
  }

  // -----------------------------------------------------------------------
  // R4 CRUD
  // -----------------------------------------------------------------------

  addLeaves(
    moduleName: string, subName: string, funcName: string,
    leaves: { sub_function: string; description: string }[],
  ): number[] {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) throw new Error(`Module "${moduleName}" not found`);
    const sub = mod.children.find((s) => s.name === subName);
    if (!sub) throw new Error(`Sub-module "${subName}" not found`);
    const func = sub.children.find((f) => f.name === funcName);
    if (!func) throw new Error(`Function "${funcName}" not found`);
    const ids: number[] = [];
    for (const leaf of leaves) {
      const tName = leaf.sub_function.trim();
      const tDesc = leaf.description.trim();
      if (!tName || !tDesc) continue;
      if (func.children.some((l) => l.name === tName)) continue;
      const node: TreeNode = { id: this.nextId++, type: "leaf", name: tName, description: tDesc, children: [] };
      func.children.push(node);
      this.idMap.set(node.id, node);
      ids.push(node.id);
    }
    return ids;
  }

  deleteLeaves(moduleName: string, subName: string, funcName: string, names: string[]): void {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) return;
    const sub = mod.children.find((s) => s.name === subName);
    if (!sub) return;
    const func = sub.children.find((f) => f.name === funcName);
    if (!func) return;
    for (const name of names) {
      const trimmed = name.trim();
      const idx = func.children.findIndex((l) => l.name === trimmed);
      if (idx === -1) continue;
      this.removeNode(func.children[idx]);
      func.children.splice(idx, 1);
    }
  }

  updateLeafDescription(moduleName: string, subName: string, funcName: string, leafName: string, newDesc: string): void {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) throw new Error(`Module "${moduleName}" not found`);
    const sub = mod.children.find((s) => s.name === subName);
    if (!sub) throw new Error(`Sub-module "${subName}" not found`);
    const func = sub.children.find((f) => f.name === funcName);
    if (!func) throw new Error(`Function "${funcName}" not found`);
    const leaf = func.children.find((l) => l.name === leafName);
    if (!leaf) throw new Error(`Leaf "${leafName}" not found under "${moduleName} → ${subName} → ${funcName}"`);
    leaf.description = newDesc.trim();
  }

  renameSubFunction(moduleName: string, subName: string, funcName: string, oldName: string, newName: string): void {
    const mod = this.root.find((m) => m.name === moduleName);
    if (!mod) throw new Error(`Module "${moduleName}" not found`);
    const sub = mod.children.find((s) => s.name === subName);
    if (!sub) throw new Error(`Sub-module "${subName}" not found`);
    const func = sub.children.find((f) => f.name === funcName);
    if (!func) throw new Error(`Function "${funcName}" not found`);
    const leaf = func.children.find((l) => l.name === oldName);
    if (!leaf) throw new Error(`Leaf "${oldName}" not found`);
    leaf.name = newName.trim();
  }

  // -----------------------------------------------------------------------
  // Mark support — set category, remove children, null description if not leaf
  // -----------------------------------------------------------------------

  markModuleSupport(name: string): void {
    const mod = this.root.find((m) => m.name === name);
    if (!mod) throw new Error(`Module "${name}" not found`);
    mod.category = "support";
    mod.description = null;
    this.removeNodeChildren(mod);
  }

  markSubModuleSupport(module: string, sub: string): void {
    const mod = this.root.find((m) => m.name === module);
    if (!mod) throw new Error(`Module "${module}" not found`);
    const s = mod.children.find((c) => c.name === sub);
    if (!s) throw new Error(`Sub-module "${sub}" not found in module "${module}"`);
    s.category = "support";
    s.description = null;
    this.removeNodeChildren(s);
  }

  markFunctionSupport(module: string, sub: string, func: string): void {
    const mod = this.root.find((m) => m.name === module);
    if (!mod) throw new Error(`Module "${module}" not found`);
    const s = mod.children.find((c) => c.name === sub);
    if (!s) throw new Error(`Sub-module "${sub}" not found`);
    const f = s.children.find((c) => c.name === func);
    if (!f) throw new Error(`Function "${func}" not found`);
    f.category = "support";
    f.description = null;
    this.removeNodeChildren(f);
  }

  markSubFunctionSupport(module: string, sub: string, func: string, leaf: string): void {
    const mod = this.root.find((m) => m.name === module);
    if (!mod) throw new Error(`Module "${module}" not found`);
    const s = mod.children.find((c) => c.name === sub);
    if (!s) throw new Error(`Sub-module "${sub}" not found`);
    const f = s.children.find((c) => c.name === func);
    if (!f) throw new Error(`Function "${func}" not found`);
    const l = f.children.find((c) => c.name === leaf);
    if (!l) throw new Error(`Leaf "${leaf}" not found`);
    l.category = "support";
    this.removeNodeChildren(l);
  }

  // -----------------------------------------------------------------------
  // Cascade remove
  // -----------------------------------------------------------------------

  private removeNode(node: TreeNode): void {
    this.idMap.delete(node.id);
    for (const child of node.children) {
      this.removeNode(child);
    }
  }

  private removeNodeChildren(node: TreeNode): void {
    for (const child of node.children) {
      this.removeNode(child);
    }
    node.children = [];
  }

  // -----------------------------------------------------------------------
  // Snapshots — for diff-based change tracking
  // -----------------------------------------------------------------------

  buildLevelSnapshot(level: number, filter?: { module: string; subModule: string }): Map<number, string> {
    const snap = new Map<number, string>();

    if (level === 1) {
      for (const mod of this.root) {
        if (mod.category === "support") continue;
        snap.set(mod.id, mod.name);
      }
      return snap;
    }

    if (level === 2) {
      for (const mod of this.root) {
        if (mod.category === "support") continue;
        for (const sub of mod.children) {
          if (sub.category === "support") continue;
          snap.set(sub.id, `${mod.name}::${sub.name}`);
        }
      }
      return snap;
    }

    if (level === 3) {
      for (const mod of this.root) {
        if (mod.category === "support") continue;
        for (const sub of mod.children) {
          if (sub.category === "support") continue;
          for (const func of sub.children) {
            if (func.category === "support") continue;
            snap.set(func.id, `${mod.name}::${sub.name}::${func.name}`);
          }
        }
      }
      return snap;
    }

    // level 4 — optionally filtered to a sub_module
    if (level === 4) {
      const mods = filter
        ? this.root.filter((m) => m.name === filter.module && m.category !== "support")
        : this.root.filter((m) => m.category !== "support");
      for (const mod of mods) {
        const subs = filter
          ? mod.children.filter((s) => s.name === filter.subModule && s.category !== "support")
          : mod.children.filter((s) => s.category !== "support");
        for (const sub of subs) {
          for (const func of sub.children) {
            if (func.category === "support") continue;
            for (const leaf of func.children) {
              if (leaf.category === "support") continue;
              snap.set(leaf.id, `${mod.name}::${sub.name}::${func.name}::${leaf.name}||${leaf.description ?? ""}`);
            }
          }
        }
      }
      return snap;
    }

    return snap;
  }

  static diffSnapshots(before: Map<number, string>, after: Map<number, string>): number[] {
    const changed = new Set<number>();
    for (const [id, val] of after) {
      if (!before.has(id) || before.get(id) !== val) changed.add(id);
    }
    for (const id of before.keys()) {
      if (!after.has(id)) changed.add(id);
    }
    return [...changed];
  }

  // -----------------------------------------------------------------------
  // Change tracking
  // -----------------------------------------------------------------------

  buildChangeSet(changedIds: number[]): RoundChangeSet {
    const cs: RoundChangeSet = { affectedIds: new Set(changedIds), affectedSubModules: new Set(), affectedFunctions: new Set() };

    for (const id of changedIds) {
      const node = this.idMap.get(id);
      if (!node) continue;

      // Walk up to resolve path
      const path = this.resolvePath(id);
      if (!path) continue;

      if (path.sub) {
        cs.affectedSubModules.add(subKey(path.mod, path.sub));
      }
      if (path.func) {
        cs.affectedFunctions.add(funcKey(path.mod, path.sub!, path.func));
      }
    }

    return cs;
  }

  private resolvePath(id: number): { mod: string; sub?: string; func?: string } | null {
    // Try to find the node and walk up by searching parents
    const node = this.idMap.get(id);
    if (!node) return null;

    // For module nodes
    if (node.type === "module") return { mod: node.name };

    // Search children of modules
    for (const mod of this.root) {
      for (const sub of mod.children) {
        if (sub.id === id) return { mod: mod.name, sub: sub.name };
        for (const func of sub.children) {
          if (func.id === id) return { mod: mod.name, sub: sub.name, func: func.name };
          for (const leaf of func.children) {
            if (leaf.id === id) return { mod: mod.name, sub: sub.name, func: func.name };
          }
        }
      }
    }

    return null;
  }

  getAffectedSubModuleKeys(changes: RoundChangeSet): Set<string> {
    return changes.affectedSubModules;
  }

  // -----------------------------------------------------------------------
  // Human-readable table formatter
  // -----------------------------------------------------------------------

  private static COL_WIDTHS: Record<string, number> = {
    id: 4,
    module: 18,
    sub_module: 16,
    function: 16,
    sub_function: 14,
    description: 24,
  };

  formatTreeForLevel(level: number): string {
    const rows = this.getRowsAtLevel(level);
    if (!rows.length) return "  (empty)";

    const cols = this.columnsForLevel(level);
    const widths = this.computeColumnWidths(rows, cols);

    const sep = cols.map((c) => "─".repeat(widths[c])).join("─┼─");
    const header = cols.map((c) => c.padEnd(widths[c])).join(" │ ");
    const lines: string[] = [
      `  ┌─${sep}─┐`,
      `  │ ${header} │`,
      `  ├─${sep}─┤`,
    ];

    for (const r of rows) {
      const vals = cols.map((c) => this.cellValue(r, c).padEnd(widths[c]));
      lines.push(`  │ ${vals.join(" │ ")} │`);
    }
    lines.push(`  └─${sep}─┘`);

    return lines.join("\n");
  }

  private columnsForLevel(level: number): string[] {
    switch (level) {
      case 1: return ["id", "module"];
      case 2: return ["id", "module", "sub_module"];
      case 3: return ["id", "module", "sub_module", "function"];
      case 4: return ["id", "module", "sub_module", "function", "sub_function", "description"];
      default: return ["id"];
    }
  }

  private computeColumnWidths(rows: LevelRow[], cols: string[]): Record<string, number> {
    const widths: Record<string, number> = {};
    for (const c of cols) {
      const headerLen = c.length;
      let maxData = 0;
      for (const r of rows) {
        maxData = Math.max(maxData, this.cellValue(r, c).length);
      }
      widths[c] = Math.min(Math.max(headerLen, maxData), DecomposerTree.COL_WIDTHS[c] ?? 20);
    }
    return widths;
  }

  private cellValue(row: LevelRow, col: string): string {
    switch (col) {
      case "id": return String(row.id);
      case "module": return row.module;
      case "sub_module": return row.sub_module ?? "";
      case "function": return row.function ?? "";
      case "sub_function": return row.sub_function ?? "";
      case "description": {
        const d = row.description ?? "";
        return d.length > 22 ? d.slice(0, 22) + ".." : d;
      }
      default: return "";
    }
  }
}
