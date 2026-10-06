/** Hors serveur Next, `unstable_cache` n'a pas de cache incrémental : en test on appelle directement la fonction. */
export const unstable_cache = <T extends (...args: never[]) => unknown>(fn: T) => fn;
export const revalidateTag = () => undefined;
export const revalidatePath = () => undefined;
