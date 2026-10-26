// s3rver (serveur S3 de test) n'a pas de types : on déclare juste ce que les tests utilisent.
declare module "s3rver" {
  export default class S3rver {
    constructor(options: { port: number; address: string; silent?: boolean; directory: string; configureBuckets?: { name: string; configs: unknown[] }[] });
    run(): Promise<unknown>;
    close(): Promise<unknown>;
  }
}
