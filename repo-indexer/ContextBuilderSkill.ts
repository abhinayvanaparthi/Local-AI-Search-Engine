import fs from 'fs';
import path from 'path';
import { Project } from 'ts-morph';

interface EmbeddingEntry {
  path: string;
  symbol: string;
  type: string;
  text: string;
  model: string;
  embedding: number[];
}

export class ContextBuilderSkill {
  private project: Project;
  private embeddings: EmbeddingEntry[];
  private index: any;
  
  constructor() {
    this.project = new Project({ skipAddingFilesFromTsConfig: true });
    
    const embedPath = path.join(process.cwd(), 'repo-embeddings.json');
    const indexPath = path.join(process.cwd(), 'repo-index.json');
    
    if (!fs.existsSync(embedPath) || !fs.existsSync(indexPath)) {
       throw new Error("Missing JSON index files. Run indexer and EmbedAgent first.");
    }

    this.embeddings = JSON.parse(fs.readFileSync(embedPath, 'utf-8'));
    this.index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0; let normA = 0; let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private async getQueryEmbedding(query: string): Promise<number[] | null> {
    try {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'unclemusclez/jina-embeddings-v2-base-code', prompt: query })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.embedding || null;
    } catch (e) {
      return null;
    }
  }

  private extractASTSymbol(filePath: string, symbol: string): string | null {
    try {
       const fullPath = path.join(process.cwd(), filePath);
       if (!fs.existsSync(fullPath)) return null;
       
       let sourceFile = this.project.getSourceFile(fullPath);
       if (!sourceFile) sourceFile = this.project.addSourceFileAtPath(fullPath);

       const cls = sourceFile.getClass(symbol);
       if (cls) return cls.getText();

       const func = sourceFile.getFunction(symbol);
       if (func) return func.getText();

       const vDecl = sourceFile.getVariableDeclaration(symbol);
       if (vDecl) {
          return vDecl.getVariableStatement()?.getText() || vDecl.getText();
       }

       const intf = sourceFile.getInterface(symbol);
       if (intf) return intf.getText();
       
       const typ = sourceFile.getTypeAlias(symbol);
       if (typ) return typ.getText();

       return null;
    } catch(e) {
       return null;
    }
  }

  public async buildContext(query: string, topN: number = 10, maxTokens: number = 8000, maxDepth: number = 1): Promise<string> {
    const queryVec = await this.getQueryEmbedding(query);
    if (!queryVec) throw new Error("Failed to get embedding from Ollama");

    const results = this.embeddings.map(entry => ({
      score: this.cosineSimilarity(queryVec, entry.embedding),
      symbol: entry.symbol,
      type: entry.type,
      path: entry.path
    })).sort((a, b) => b.score - a.score).slice(0, topN);

    let contextString = `=========================================\n`;
    contextString += `CONTEXT PACKAGE GENERATED\n`;
    contextString += `Query: "${query}"\n`;
    contextString += `=========================================\n\n`;

    const processedPaths = new Set<string>();
    let totalChars = 0;
    let currentTokens = 0;

    const checkBudget = (newChars: number) => {
       const tokens = Math.floor(newChars / 4);
       if (currentTokens + tokens > maxTokens) return false;
       currentTokens += tokens;
       totalChars += newChars;
       return true;
    };

    // Phase 1: Core Semantic Matches
    for (const res of results) {
       let blockStr = `Relevant File: ${res.path}\n`;
       blockStr += `Semantic Match: ${res.symbol} (${res.type}) | Score: ${res.score.toFixed(4)}\n\n`;

       let codeStr = this.extractASTSymbol(res.path, res.symbol);
       if (codeStr) {
          blockStr += `Code (${res.symbol}):\n\`\`\`tsx\n${codeStr}\n\`\`\`\n\n`;
       } else {
          const fullPath = path.join(process.cwd(), res.path);
          if (fs.existsSync(fullPath)) {
            codeStr = fs.readFileSync(fullPath, 'utf-8');
            blockStr += `Code (Whole File Fallback):\n\`\`\`tsx\n${codeStr}\n\`\`\`\n\n`;
          }
       }
       
       if (codeStr) {
          if (!checkBudget(blockStr.length)) {
             contextString += `\n[WARNING] Max token budget (${maxTokens}) reached. Stopping semantic extraction.\n`;
             break;
          }
          contextString += blockStr;
       }
       processedPaths.add(res.path);
    }
    
    // Phase 2: Dependency Expansion
    if (maxDepth > 0 && currentTokens < maxTokens) {
        contextString += `--- DEPENDENCY EXPANSION ---\n\n`;
        let budgetReached = false;

        for (const res of results) {
           if (budgetReached) break;
           const fileMeta = this.index.files[res.path];
           
           if (fileMeta && fileMeta.dependencies) {
              for (const dep of fileMeta.dependencies) {
                 if (budgetReached) break;
                 const matchedKey = Object.keys(this.index.files).find(k => k.replace(/\.[^/.]+$/, "") === dep.path.replace(/\.[^/.]+$/, ""));
                 
                 if (matchedKey && !processedPaths.has(matchedKey)) {
                    for (const impName of dep.importedNames) {
                       if (impName === 'default' || impName === 'React') continue;
                       let depCode = this.extractASTSymbol(matchedKey, impName);
                       if (depCode) {
                          let blockStr = `Dependency: ${matchedKey} (Imported by ${res.symbol})\n`;
                          blockStr += `Code (${impName}):\n\`\`\`tsx\n${depCode}\n\`\`\`\n\n`;
                          
                          if (!checkBudget(blockStr.length)) {
                             budgetReached = true;
                             contextString += `\n[WARNING] Max token budget (${maxTokens}) reached. Stopping dependency expansion.\n`;
                             break;
                          }
                          contextString += blockStr;
                       }
                    }
                    processedPaths.add(matchedKey);
                 }
              }
           }
        }
    }

    contextString += `=========================================\n`;
    contextString += `STATISTICS\n`;
    contextString += `Total Characters: ${totalChars}\n`;
    contextString += `Estimated Tokens: ~${currentTokens} / ${maxTokens}\n`;
    contextString += `=========================================\n`;

    return contextString;
  }
}
