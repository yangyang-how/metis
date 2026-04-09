// engine/src/apply/errors.ts
/**
 * Typed errors for the Apply pipeline.
 * Each stage has its own error code namespace.
 */
export type ApplyStage =
  | "understand"
  | "retrieve"
  | "rerank"
  | "traverse"
  | "gaps"
  | "compose";

export class ApplyError extends Error {
  constructor(
    public readonly stage: ApplyStage,
    message: string,
    public readonly cause?: Error,
  ) {
    super(`[apply/${stage}] ${message}`);
    this.name = "ApplyError";
  }
}
