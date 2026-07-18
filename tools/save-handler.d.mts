export interface SaveResult { ok: boolean; errors: string[]; written: string[] }
export declare function applySave(
  rootDir: string,
  files: Array<{ file: string; doc: unknown }>,
): SaveResult;
