import path from 'path';
import fs from 'fs/promises';
import { ScannerSkill } from './ScannerSkill';
import { StorageSkill, IndexedFile } from './StorageSkill';
import { ExtractorSkill } from './ExtractorSkill';
import { SummarizerSkill } from './SummarizerSkill';
import dotenv from 'dotenv';

export class RepoIndexAgent {
  private baseDir: string;
  private indexPath: string;
  private tsConfigPath: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.indexPath = path.join(this.baseDir, 'repo-index.json');
    this.tsConfigPath = path.join(this.baseDir, 'tsconfig.json');
  }

  async run() {
    // Load env.local for API keys
    dotenv.config({ path: path.join(this.baseDir, '.env.local') });

    console.log(`Starting repo index agent for base dir: ${this.baseDir}`);
    
    const storage = new StorageSkill(this.indexPath);
    const scanner = new ScannerSkill(this.baseDir);
    const extractor = new ExtractorSkill(this.tsConfigPath);
    const summarizer = new SummarizerSkill();

    const index = await storage.loadIndex();
    const scannedFiles = await scanner.scan();

    let newOrModifiedCount = 0;
    let unchangedCount = 0;

    const activeFiles = new Set<string>();

    for (const scanned of scannedFiles) {
      activeFiles.add(scanned.path);

      const existing = index.files[scanned.path];
      const isNew = !existing;
      const isModified = existing && (existing.lastModified !== scanned.lastModified || existing.contentHash !== scanned.contentHash);
      const isMissingFields = existing && (existing.loc === undefined || existing.dependencies === undefined || existing.exportedSymbols === undefined || existing.functionCalls === undefined);
      const force = process.argv.includes('--force');

      if (isNew || isModified || isMissingFields || force) {
        newOrModifiedCount++;
        console.log(`Processing ${isNew ? 'NEW' : 'MODIFIED'}: ${scanned.path}`);
        
        const fullPath = path.join(this.baseDir, scanned.path);
        const metadata = extractor.extract(fullPath);

        if (metadata) {
          // Summarizer temporarily disabled to save API quota
          // const content = await fs.readFile(fullPath, 'utf-8');
          // const snippet = content.substring(0, 1000);
          
          let summary = existing?.summary || "";
          if (!summary || summary.startsWith("Placeholder") || summary.startsWith("Error") || isModified) {
            summary = "Summary Generation Disabled.";
          }

          index.files[scanned.path] = {
            path: scanned.path,
            fileType: metadata.fileType,
            loc: metadata.loc,
            nextjs: metadata.nextjs,
            dependencies: metadata.dependencies,
            importedNames: metadata.importedNames,
            exportedSymbols: metadata.exportedSymbols,
            components: metadata.components,
            hooks: metadata.hooks,
            functions: metadata.functions,
            functionCalls: metadata.functionCalls,
            types: metadata.types,
            summary: summary,
            lastModified: scanned.lastModified,
            contentHash: scanned.contentHash,
          };
        }
      } else {
        unchangedCount++;
      }
    }

    let deletedCount = 0;
    for (const indexedPath of Object.keys(index.files)) {
      if (!activeFiles.has(indexedPath)) {
        console.log(`Processing DELETED: ${indexedPath}`);
        delete index.files[indexedPath];
        deletedCount++;
      }
    }

    console.log(`Indexing complete. New/Modified: ${newOrModifiedCount}, Unchanged: ${unchangedCount}, Deleted: ${deletedCount}`);
    await storage.saveIndex(index);
    console.log(`Index saved to ${this.indexPath}`);
  }
}

if (require.main === module) {
  const workspaceRoot = path.resolve(__dirname, '../../');
  const agent = new RepoIndexAgent(workspaceRoot);
  agent.run().catch(console.error);
}
