/**
 * DecomposerTable — shared mutable table across R1→R4 agents.
 *
 * Each row has a stable `index` (natural number, never changes).
 * Columns fill progressively: R1 fills `module`, R2 fills `sub_module`,
 * R3 fills `function`, R4 fills `sub_function` + `description`.
 *
 * Modification rounds: table starts from previousRows.
 * Full decomposition: table starts empty, agents populate it level by level.
 */
import type { QuotationRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Internal row type — all columns nullable except index
// ---------------------------------------------------------------------------

export interface DecomposerRow {
  index: number;
  module: string | null;
  sub_module: string | null;
  function: string | null;
  sub_function: string | null;
  description: string | null;
}

/** Minimal visible row for a given level (only columns up to that level). */
export interface LevelRow {
  index: number;
  module: string;
  sub_module: string | null;
  function: string | null;
  sub_function: string | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Change tracking — for pruning downstream rounds
// ---------------------------------------------------------------------------

export interface RoundChangeSet {
  /** Indices of rows whose level-N column was added or modified. */
  affectedIndices: Set<number>;
  /** (module, sub_module) pairs affected — for R3 pruning. */
  affectedSubModules: Set<string>;
  /** (module, sub_module, function) triples affected — for R4 pruning. */
  affectedFunctions: Set<string>;
}

function makeSubModuleKey(module: string, sub: string): string {
  return `${module}::${sub}`;
}

function makeFunctionKey(module: string, sub: string, func: string): string {
  return `${module}::${sub}::${func}`;
}

// ---------------------------------------------------------------------------
// DecomposerTable
// ---------------------------------------------------------------------------

export class DecomposerTable {
  private rows: DecomposerRow[] = [];
  private nextIndex = 1;

  // -----------------------------------------------------------------------
  // Factory: initialize from previous decomposition (modification round)
  // -----------------------------------------------------------------------

  static fromPreviousRows(previousRows?: QuotationRow[]): DecomposerTable {
    const table = new DecomposerTable();
    if (!previousRows?.length) return table;

    for (const row of previousRows) {
      table.rows.push({
        index: table.nextIndex++,
        module: row.module,
        sub_module: row.sub_module,
        function: row.function,
        sub_function: row.sub_function,
        description: row.description,
      });
    }
    return table;
  }

  // -----------------------------------------------------------------------
  // Convert to QuotationRow[] — final output, only fully-populated rows
  // -----------------------------------------------------------------------

  toQuotationRows(): QuotationRow[] {
    const leaves = this.rows.filter(
      (r) =>
        r.module != null &&
        r.sub_module != null &&
        r.function != null &&
        r.sub_function != null &&
        r.description != null,
    );

    return leaves.map((r, i) => ({
      seq: i + 1,
      module: r.module!,
      sub_module: r.sub_module!,
      function: r.function!,
      sub_function: r.sub_function!,
      description: r.description!,
      category: "feature" as const,
      trades: {},
      remark: "",
    }));
  }

  // -----------------------------------------------------------------------
  // Row access
  // -----------------------------------------------------------------------

  /** Get all rows (internal). */
  getAllRows(): DecomposerRow[] {
    return this.rows;
  }

  /** Get row by index. */
  getRow(index: number): DecomposerRow | undefined {
    return this.rows.find((r) => r.index === index);
  }

  // -----------------------------------------------------------------------
  // Level-scoped views
  // -----------------------------------------------------------------------

  /**
   * Get rows visible at level N (columns 1..N populated, N+1..5 may be null).
   *
   * Level 1 (R1 view): rows where module is non-null.
   * Level 2 (R2 view): rows where module is non-null (sub_module may be null
   *                    for parent module rows, or non-null for sub_module rows).
   * Level 3 (R3 view): rows where module AND sub_module are non-null.
   * Level 4 (R4 view): rows where module, sub_module, function are non-null.
   */
  getRowsAtLevel(level: number): LevelRow[] {
    return this.rows
      .filter((r) => {
        if (r.module == null) return false;
        if (level >= 2 && r.sub_module == null) return false;
        if (level >= 3 && r.function == null) return false;
        if (level >= 4 && r.sub_function == null) return false;
        return true;
      })
      .map((r) => ({
        index: r.index,
        module: r.module!,
        sub_module: r.sub_module,
        function: r.function,
        sub_function: r.sub_function,
        description: r.description,
      }));
  }

  /**
   * Get rows at level N, pruned to only those affected by parent round changes.
   *
   * For R3 pruning (level=3): only rows whose (module, sub_module) is in changes.
   * For R4 pruning (level=4): only rows whose (module, sub_module, function) is in changes.
   */
  getRowsAtLevelPruned(level: number, changes: RoundChangeSet): LevelRow[] {
    return this.rows
      .filter((r) => {
        if (r.module == null || r.sub_module == null) return false;
        if (level === 3) {
          if (r.function != null) return false; // R3 adds functions; view is R2-level rows
          return changes.affectedSubModules.has(makeSubModuleKey(r.module, r.sub_module));
        }
        if (level === 4) {
          if (r.function == null) return false;
          return changes.affectedFunctions.has(
            makeFunctionKey(r.module, r.sub_module, r.function),
          );
        }
        return false;
      })
      .map((r) => ({
        index: r.index,
        module: r.module!,
        sub_module: r.sub_module,
        function: r.function,
        sub_function: r.sub_function,
        description: r.description,
      }));
  }

  /**
   * Group R3-level rows by sub_module (identified by module + sub_module pair).
   * Returns Map<subModuleKey, { module, subModule, funcs: LevelRow[] }>
   */
  groupBySubModule(rows: LevelRow[]): Map<string, { module: string; subModule: string; funcs: LevelRow[] }> {
    const map = new Map<string, { module: string; subModule: string; funcs: LevelRow[] }>();
    for (const r of rows) {
      const key = makeSubModuleKey(r.module, r.sub_module!);
      let entry = map.get(key);
      if (!entry) {
        entry = { module: r.module, subModule: r.sub_module!, funcs: [] };
        map.set(key, entry);
      }
      entry.funcs.push(r);
    }
    return map;
  }

  // -----------------------------------------------------------------------
  // R1 CRUD: module level
  // -----------------------------------------------------------------------

  /** Get distinct modules from the table. */
  getModules(): string[] {
    const modules = new Set<string>();
    for (const r of this.rows) {
      if (r.module) modules.add(r.module);
    }
    return [...modules];
  }

  addModules(moduleNames: string[]): number[] {
    const indices: number[] = [];
    for (const name of moduleNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      // Avoid duplicating existing modules (case-insensitive check)
      const existing = this.rows.find(
        (r) => r.module?.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) continue;
      const idx = this.nextIndex++;
      this.rows.push({
        index: idx,
        module: trimmed,
        sub_module: null,
        function: null,
        sub_function: null,
        description: null,
      });
      indices.push(idx);
    }
    return indices;
  }

  deleteModules(moduleNames: string[]): void {
    for (const name of moduleNames) {
      const trimmed = name.trim();
      // Cascade: delete all rows with this module
      this.rows = this.rows.filter(
        (r) => r.module !== trimmed,
      );
    }
  }

  renameModule(oldName: string, newName: string): void {
    const trimmed = newName.trim();
    for (const r of this.rows) {
      if (r.module === oldName) {
        r.module = trimmed;
      }
    }
  }

  // -----------------------------------------------------------------------
  // R2 CRUD: sub_module level
  // -----------------------------------------------------------------------

  /**
   * Get distinct (module, sub_module) pairs for existing sub_module rows.
   * For the R2 agent's view during full decomposition, there are no sub_module
   * rows yet — it sees the module rows and creates sub_module rows.
   */
  getSubModules(): { module: string; sub_module: string }[] {
    const seen = new Set<string>();
    const result: { module: string; sub_module: string }[] = [];
    for (const r of this.rows) {
      if (r.module && r.sub_module) {
        const key = makeSubModuleKey(r.module, r.sub_module);
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ module: r.module, sub_module: r.sub_module });
        }
      }
    }
    return result;
  }

  addSubModules(module: string, subModuleNames: string[]): number[] {
    const indices: number[] = [];
    // Verify module exists
    if (!this.rows.some((r) => r.module === module)) {
      throw new Error(`Cannot add sub-modules: module "${module}" does not exist`);
    }
    for (const name of subModuleNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      // Avoid duplicating existing sub_modules under this module
      const existing = this.rows.find(
        (r) => r.module === module && r.sub_module === trimmed,
      );
      if (existing) continue;
      const idx = this.nextIndex++;
      this.rows.push({
        index: idx,
        module,
        sub_module: trimmed,
        function: null,
        sub_function: null,
        description: null,
      });
      indices.push(idx);
    }
    return indices;
  }

  deleteSubModules(module: string, subModuleNames: string[]): void {
    for (const name of subModuleNames) {
      // Cascade: delete all rows with this module + sub_module
      this.rows = this.rows.filter(
        (r) => !(r.module === module && r.sub_module === name.trim()),
      );
    }
  }

  renameSubModule(module: string, oldName: string, newName: string): void {
    const trimmed = newName.trim();
    for (const r of this.rows) {
      if (r.module === module && r.sub_module === oldName) {
        r.sub_module = trimmed;
      }
    }
  }

  // -----------------------------------------------------------------------
  // R3 CRUD: function level
  // -----------------------------------------------------------------------

  addFunctions(module: string, subModule: string, functionNames: string[]): number[] {
    const indices: number[] = [];
    // Verify sub_module exists
    if (
      !this.rows.some((r) => r.module === module && r.sub_module === subModule)
    ) {
      throw new Error(
        `Cannot add functions: sub_module "${module} → ${subModule}" does not exist`,
      );
    }
    for (const name of functionNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const existing = this.rows.find(
        (r) =>
          r.module === module &&
          r.sub_module === subModule &&
          r.function === trimmed,
      );
      if (existing) continue;
      const idx = this.nextIndex++;
      this.rows.push({
        index: idx,
        module,
        sub_module: subModule,
        function: trimmed,
        sub_function: null,
        description: null,
      });
      indices.push(idx);
    }
    return indices;
  }

  deleteFunctions(module: string, subModule: string, functionNames: string[]): void {
    for (const name of functionNames) {
      this.rows = this.rows.filter(
        (r) =>
          !(
            r.module === module &&
            r.sub_module === subModule &&
            r.function === name.trim()
          ),
      );
    }
  }

  renameFunction(
    module: string,
    subModule: string,
    oldName: string,
    newName: string,
  ): void {
    const trimmed = newName.trim();
    for (const r of this.rows) {
      if (
        r.module === module &&
        r.sub_module === subModule &&
        r.function === oldName
      ) {
        r.function = trimmed;
      }
    }
  }

  // -----------------------------------------------------------------------
  // R4 CRUD: sub_function + description level
  // -----------------------------------------------------------------------

  addLeaves(
    module: string,
    subModule: string,
    funcName: string,
    leaves: { sub_function: string; description: string }[],
  ): number[] {
    const indices: number[] = [];
    // Verify function exists
    if (
      !this.rows.some(
        (r) =>
          r.module === module &&
          r.sub_module === subModule &&
          r.function === funcName,
      )
    ) {
      throw new Error(
        `Cannot add leaves: function "${module} → ${subModule} → ${funcName}" does not exist`,
      );
    }
    for (const leaf of leaves) {
      const trimmedSub = leaf.sub_function.trim();
      const trimmedDesc = leaf.description.trim();
      if (!trimmedSub || !trimmedDesc) continue;
      const idx = this.nextIndex++;
      this.rows.push({
        index: idx,
        module,
        sub_module: subModule,
        function: funcName,
        sub_function: trimmedSub,
        description: trimmedDesc,
      });
      indices.push(idx);
    }
    return indices;
  }

  deleteLeaves(
    module: string,
    subModule: string,
    funcName: string,
    subFunctionNames: string[],
  ): void {
    for (const name of subFunctionNames) {
      this.rows = this.rows.filter(
        (r) =>
          !(
            r.module === module &&
            r.sub_module === subModule &&
            r.function === funcName &&
            r.sub_function === name.trim()
          ),
      );
    }
  }

  updateLeafDescription(
    module: string,
    subModule: string,
    funcName: string,
    subFuncName: string,
    newDescription: string,
  ): void {
    for (const r of this.rows) {
      if (
        r.module === module &&
        r.sub_module === subModule &&
        r.function === funcName &&
        r.sub_function === subFuncName
      ) {
        r.description = newDescription.trim();
        return;
      }
    }
  }

  renameSubFunction(
    module: string,
    subModule: string,
    funcName: string,
    oldName: string,
    newName: string,
  ): void {
    for (const r of this.rows) {
      if (
        r.module === module &&
        r.sub_module === subModule &&
        r.function === funcName &&
        r.sub_function === oldName
      ) {
        r.sub_function = newName.trim();
        return;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Change tracking helpers
  // -----------------------------------------------------------------------

  /** Create an empty change set. */
  static emptyChangeSet(): RoundChangeSet {
    return {
      affectedIndices: new Set(),
      affectedSubModules: new Set(),
      affectedFunctions: new Set(),
    };
  }

  /**
   * Build a change set from a list of added/modified indices.
   * Populates sub_module and function keys automatically.
   */
  buildChangeSet(indices: number[]): RoundChangeSet {
    const cs: RoundChangeSet = {
      affectedIndices: new Set(indices),
      affectedSubModules: new Set(),
      affectedFunctions: new Set(),
    };
    for (const idx of indices) {
      const row = this.rows.find((r) => r.index === idx);
      if (!row) continue;
      if (row.module && row.sub_module) {
        cs.affectedSubModules.add(makeSubModuleKey(row.module, row.sub_module));
        if (row.function) {
          cs.affectedFunctions.add(
            makeFunctionKey(row.module, row.sub_module, row.function),
          );
        }
      }
    }
    return cs;
  }

  /**
   * For R4 pruning: get (module, sub_module) keys that are affected.
   * Returns set of "module::sub_module" strings.
   */
  getAffectedSubModuleKeys(changes: RoundChangeSet): Set<string> {
    return changes.affectedSubModules;
  }

  /**
   * Get rows for a specific sub_module (module, sub_module pair)
   * at level 4 (function + sub_function + description visible).
   * Optionally pruned to only rows whose function is in the change set.
   */
  getRowsForSubModule(
    module: string,
    subModule: string,
    prunedFunctionKeys?: Set<string>,
  ): LevelRow[] {
    return this.rows
      .filter((r) => {
        if (r.module !== module || r.sub_module !== subModule) return false;
        if (r.function == null) return false;
        if (prunedFunctionKeys) {
          return prunedFunctionKeys.has(
            makeFunctionKey(module, subModule, r.function),
          );
        }
        return true;
      })
      .map((r) => ({
        index: r.index,
        module: r.module!,
        sub_module: r.sub_module,
        function: r.function,
        sub_function: r.sub_function,
        description: r.description,
      }));
  }
}
