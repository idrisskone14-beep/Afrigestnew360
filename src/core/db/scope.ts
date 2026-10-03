import { AppError } from "@/core/errors";
import { TENANT_KEY } from "./tenant-models";

type Rec = Record<string, unknown>;

const UNIQUE_WHERE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
const FILTER_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

/** Catalogues globaux : lisibles depuis un contexte tenant, jamais modifiables. */
const GLOBAL_READONLY = new Set(["Permission", "Module", "Plan", "PlanModule", "PlanLimit"]);
/** Identité et plateforme : interdits depuis un contexte tenant (passer par les services d'authentification). */
const GLOBAL_DENIED = new Set(["User", "UserSession", "AuthToken", "DemoRequest"]);
const READ_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
]);

const violation = (msg: string) => new AppError("TENANT_VIOLATION", msg);

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stampData(model: string, key: string, companyId: string, data: unknown): Rec {
  if (!isRec(data)) throw violation(`Données invalides pour ${model}.`);
  const current = data[key];
  if (current !== undefined && current !== companyId) {
    throw violation(`${model}: ${key} étranger refusé.`);
  }
  if ("company" in data) {
    throw violation(`${model}: utilisez le scalaire ${key} (pas la relation « company »).`);
  }
  return { ...data, [key]: companyId };
}

function assertNoForeignKey(model: string, key: string, companyId: string, data: unknown) {
  if (isRec(data) && data[key] !== undefined && data[key] !== companyId) {
    throw violation(`${model}: modification de ${key} refusée.`);
  }
}

/**
 * Couche applicative d'isolation : injecte l'entreprise active dans toute requête sur un modèle tenant.
 * C'est la 2ᵉ couche ; la RLS PostgreSQL (3ᵉ couche) reste la garantie finale.
 */
export function scopeArgs(model: string, operation: string, args: unknown, companyId: string): unknown {
  const key = TENANT_KEY[model];
  if (!key) {
    if (GLOBAL_DENIED.has(model)) throw violation(`${model} n'est pas accessible depuis un contexte entreprise.`);
    if (GLOBAL_READONLY.has(model) && !READ_OPS.has(operation)) {
      throw violation(`${model} est en lecture seule depuis un contexte entreprise.`);
    }
    return args;
  }

  const a: Rec = isRec(args) ? { ...args } : {};

  if (model === "Company" && (operation === "create" || operation === "createMany" || operation === "createManyAndReturn")) {
    throw violation("La création d'entreprise est réservée à la plateforme.");
  }

  if (UNIQUE_WHERE_OPS.has(operation)) {
    const where: Rec = isRec(a.where) ? { ...a.where } : {};
    const w = where[key];
    if (typeof w === "string" && w !== companyId) throw violation(`${model}: ${key} étranger refusé.`);
    a.where = { ...where, [key]: companyId };
  } else if (FILTER_OPS.has(operation)) {
    a.where = { AND: [isRec(a.where) ? a.where : {}, { [key]: companyId }] };
  }

  switch (operation) {
    case "create":
      a.data = stampData(model, key, companyId, a.data);
      break;
    case "createMany":
    case "createManyAndReturn":
      a.data = Array.isArray(a.data)
        ? a.data.map((d) => stampData(model, key, companyId, d))
        : stampData(model, key, companyId, a.data);
      break;
    case "upsert":
      a.create = stampData(model, key, companyId, a.create);
      assertNoForeignKey(model, key, companyId, a.update);
      break;
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      assertNoForeignKey(model, key, companyId, a.data);
      break;
    default:
      break;
  }
  return a;
}
