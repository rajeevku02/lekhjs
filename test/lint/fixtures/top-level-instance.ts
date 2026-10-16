class Registry {
  readonly names: string[] = [];
}

// AC-ARC-06: a top-level class instance is module state.
export const registry = new Registry();
