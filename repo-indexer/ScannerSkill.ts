import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface ScannedFile {
  path: string;
  lastModified: string;
  contentHash: string;
}

export class ScannerSkill {
  private baseDir: string;
  private ignoreDirs = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.git']);
  private validExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async scan(): Promise<ScannedFile[]> {
    const results: ScannedFile[] = [];
    await this.walk(this.baseDir, results);
    return results;
  }

  private async walk(currentDir: string, results: ScannedFile[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (e) {
      console.error(`Failed to read directory: ${currentDir}`, e);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        if (this.ignoreDirs.has(entry.name)) continue;
        await this.walk(fullPath, results);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!this.validExtensions.has(ext)) continue;

        try {
          // Normalize to forward slashes for consistent keys
          const relativePath = path.relative(this.baseDir, fullPath).replace(/\\/g, '/');
          const stat = await fs.stat(fullPath);
          const content = await fs.readFile(fullPath, 'utf-8');
          const hash = crypto.createHash('sha256').update(content).digest('hex');

          results.push({
            path: relativePath,
            lastModified: stat.mtime.toISOString(),
            contentHash: hash,
          });
        } catch (e) {
           console.error(`Failed to process file: ${fullPath}`, e);
        }
      }
    }
  }
}
