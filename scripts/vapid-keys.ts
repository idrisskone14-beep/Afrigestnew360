/**
 * Génère une paire de clés VAPID pour les notifications push. À lancer UNE fois par environnement, puis à copier dans les variables
 * d'environnement (Vercel : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). La clé privée est un secret : ne la partagez pas.
 * Changer de clés invalide les inscriptions existantes : chaque utilisateur doit réactiver les notifications sur ses appareils.
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("\nCopiez ces trois lignes dans les variables d'environnement :\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:contact@ivoireactu.com\n");
