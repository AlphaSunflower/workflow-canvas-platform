declare module 'node:test' {
  const test: (
    name: string,
    fn: (context?: unknown) => void | Promise<void>,
  ) => void;

  export default test;
}

declare module 'node:assert/strict' {
  const assert: {
    equal: (actual: unknown, expected: unknown, message?: string) => void;
    deepEqual: (actual: unknown, expected: unknown, message?: string) => void;
    ok: (value: unknown, message?: string) => void;
    strictEqual: (actual: unknown, expected: unknown, message?: string) => void;
    notStrictEqual: (actual: unknown, expected: unknown, message?: string) => void;
    rejects: (
      block: (() => Promise<unknown>) | Promise<unknown>,
      error?: RegExp | ((error: unknown) => boolean),
      message?: string,
    ) => Promise<void>;
  };

  export default assert;
}
