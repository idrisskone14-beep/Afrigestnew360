export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "MODULE_DISABLED"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "LIMIT_REACHED"
  | "BUSINESS_RULE"
  | "RATE_LIMITED"
  | "TENANT_VIOLATION"
  | "INTERNAL";

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  MODULE_DISABLED: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  LIMIT_REACHED: 402,
  BUSINESS_RULE: 422,
  RATE_LIMITED: 429,
  TENANT_VIOLATION: 403,
  INTERNAL: 500,
};

export type FieldErrors = Record<string, string[]>;

/** Erreur attendue, dont le message peut être montré à l'utilisateur. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;

  constructor(code: ErrorCode, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.fieldErrors = fieldErrors;
  }
}

export const unauthenticated = (message = "Veuillez vous connecter.") =>
  new AppError("UNAUTHENTICATED", message);
export const forbidden = (message = "Vous n'avez pas la permission d'effectuer cette action.") =>
  new AppError("FORBIDDEN", message);
export const moduleDisabled = (moduleName: string) =>
  new AppError("MODULE_DISABLED", `Le module « ${moduleName} » n'est pas activé pour votre entreprise.`);
export const notFound = (what = "Ressource") => new AppError("NOT_FOUND", `${what} introuvable.`);
export const conflict = (message: string) => new AppError("CONFLICT", message);
export const businessRule = (message: string) => new AppError("BUSINESS_RULE", message);
export const limitReached = (message: string) => new AppError("LIMIT_REACHED", message);

export type ActionError = { code: ErrorCode; message: string; fieldErrors?: FieldErrors };
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: ActionError };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
