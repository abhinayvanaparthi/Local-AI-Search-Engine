import fs from 'fs/promises';
import path from 'path';

export interface IndexedFile {
  path: string;
  fileType: string;
  loc: number;
  nextjs?: {
    route: string;
    routeSegments: string[];
    type: 'page' | 'layout' | 'api' | 'component';
  };
  dependencies: {
    path: string;
    importedNames: string[];
  }[];
  importedNames: string[];
  exportedSymbols: string[];
  components: string[];
  hooks: string[];
  functions: string[];
  functionCalls: { functionName: string; calls: string[] }[];
  types: string[];
  summary: string;
  lastModified: string;
  contentHash: string;
}

export interface RepoIndex {
  version: string;
  lastIndexed: string;
  files: Record<string, IndexedFile>;
}

export class StorageSkill {
  private indexPath: string;

  constructor(indexPath: string) {
    this.indexPath = indexPath;
  }

  async loadIndex(): Promise<RepoIndex> {
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      return JSON.parse(data) as RepoIndex;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { version: '1.0', lastIndexed: new Date().toISOString(), files: {} };
      }
      throw error;
    }
  }

  async saveIndex(index: RepoIndex): Promise<void> {
    const dir = path.dirname(this.indexPath);
    await fs.mkdir(dir, { recursive: true });
    index.lastIndexed = new Date().toISOString();
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }
}
