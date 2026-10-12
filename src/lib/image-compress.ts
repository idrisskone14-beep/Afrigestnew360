/**
 * Réduit une photo avant l'envoi (téléphone : 4 à 12 Mo) : côté long ramené à `maxSide` px, JPEG qualité `quality`.
 * Un justificatif lisible tient dans 300 à 800 Ko ; l'envoi reste rapide sur réseau mobile. En cas d'échec (format non décodable),
 * le fichier d'origine est renvoyé tel quel.
 */
export async function compressImage(file: File, { maxSide = 1800, quality = 0.82 }: { maxSide?: number; quality?: number } = {}): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // fond blanc : une image transparente (PNG) ne devient pas noire en JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "justificatif"}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
