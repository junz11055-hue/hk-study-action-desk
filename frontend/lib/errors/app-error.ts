export type AppErrorCode =
  | "ACTION_CARD_NOT_FOUND"
  | "VIEW_MODEL_CONTRACT_INVALID";

type AppErrorOptions = {
  code: AppErrorCode;
  safeMessage: string;
  retryable: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly safeMessage: string;
  readonly retryable: boolean;

  constructor(options: AppErrorOptions) {
    super(options.safeMessage, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.safeMessage = options.safeMessage;
    this.retryable = options.retryable;
  }
}
