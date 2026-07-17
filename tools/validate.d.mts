export interface RepoDocs {
  station: any;
  floors: Map<string, any>;
  connectors: any;
  sources: any;
}
export declare function loadRepoDocs(rootDir: string): RepoDocs;
export declare function validateDocs(docs: RepoDocs): { errors: string[]; warnings: string[] };
