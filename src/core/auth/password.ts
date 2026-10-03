import bcrypt from "bcryptjs";

export { passwordSchema } from "./password-policy";

const COST = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

let dummyHash: Promise<string> | undefined;

/** Comparaison factice pour égaliser le temps de réponse quand l'utilisateur n'existe pas. */
export async function dummyVerify(plain: string): Promise<void> {
  dummyHash ??= bcrypt.hash("afrigest-dummy", COST);
  await bcrypt.compare(plain, await dummyHash);
}
