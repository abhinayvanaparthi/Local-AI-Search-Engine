import { RepoIndex, IndexedFile } from './StorageSkill';
import fs from 'fs';
import path from 'path';

export interface ImpactNode {
  path: string;
  importedNames: string[];
  importers: ImpactNode[];
}

export interface ImpactResult {
  originFiles: string[];
  flatAffectedFiles: string[];
  tree: ImpactNode[];
}

export class SearchSkill {
  private index: RepoIndex;

  constructor(indexPath: string) {
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Index file not found at ${indexPath}. Please run the indexer first.`);
    }
    const data = fs.readFileSync(indexPath, 'utf-8');
    this.index = JSON.parse(data);
  }

  find(term: string): IndexedFile[] {
    const termLower = term.toLowerCase();
    const results: IndexedFile[] = [];

    for (const file of Object.values(this.index.files)) {
      if (
        file.path.toLowerCase().includes(termLower) ||
        (file.exportedSymbols && file.exportedSymbols.some(s => s.toLowerCase() === termLower)) ||
        (file.components && file.components.some(s => s.toLowerCase() === termLower)) ||
        (file.hooks && file.hooks.some(s => s.toLowerCase() === termLower)) ||
        (file.functions && file.functions.some(s => s.toLowerCase() === termLower)) ||
        (file.types && file.types.some(s => s.toLowerCase() === termLower)) ||
        (file.importedNames && file.importedNames.some(s => s.toLowerCase() === termLower))
      ) {
        results.push(file);
      }
    }
    return results;
  }

  whoUses(symbol: string): { file: IndexedFile, matchedNames: string[] }[] {
    const results: { file: IndexedFile, matchedNames: string[] }[] = [];
    
    for (const file of Object.values(this.index.files)) {
      if (!file.dependencies) continue;
      
      let matchedNames: string[] = [];
      for (const dep of file.dependencies) {
        if (dep.importedNames.includes(symbol) || dep.path.includes(symbol)) {
          if (dep.importedNames.includes(symbol)) matchedNames.push(symbol);
          else matchedNames.push(dep.path);
        }
      }
      
      if (matchedNames.length > 0) {
        results.push({ file, matchedNames: Array.from(new Set(matchedNames)) });
      }
    }
    return results;
  }

  findRoute(route: string): IndexedFile[] {
    let normalized = route.toLowerCase().replace(/\\/g, '/');
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);

    const results: IndexedFile[] = [];
    for (const file of Object.values(this.index.files)) {
      if (!file.nextjs) continue;
      
      let fileRoute = file.nextjs.route.toLowerCase();
      if (fileRoute.length > 1 && fileRoute.endsWith('/')) fileRoute = fileRoute.slice(0, -1);
      
      if (
        fileRoute === normalized || 
        fileRoute.includes(normalized) || 
        file.nextjs.routeSegments.some(s => s.toLowerCase() === route.toLowerCase().replace(/^\/|\/$/g, ''))
      ) {
        results.push(file);
      }
    }
    return results;
  }

  private matchPath(depPath: string, targetPath: string): boolean {
    const d = depPath.replace(/\.(tsx|ts|jsx|js)$/, '');
    const t = targetPath.replace(/\.(tsx|ts|jsx|js)$/, '');
    return d === t || t.endsWith('/' + d) || d.endsWith('/' + t);
  }

  getImpactGraph(symbol: string): ImpactResult {
    const originFiles = Object.values(this.index.files)
      .filter(f => (f.exportedSymbols && f.exportedSymbols.includes(symbol)) || f.path.includes(symbol))
      .map(f => f.path);

    const flatAffectedFiles = new Set<string>();
    const globalVisited = new Set<string>();

    const traverse = (targetSymbol: string, targetPath: string, currentPathVisited: Set<string>): ImpactNode[] => {
      if (currentPathVisited.has(targetPath)) return []; 
      currentPathVisited.add(targetPath);
      
      const importers: { file: IndexedFile, importedNames: string[] }[] = [];
      
      for (const file of Object.values(this.index.files)) {
        if (!file.dependencies) continue;
        const dep = file.dependencies.find(d => 
          (targetSymbol && d.importedNames.includes(targetSymbol)) || 
          this.matchPath(d.path, targetPath)
        );
        if (dep) {
          importers.push({ file, importedNames: dep.importedNames });
        }
      }
      
      const nodes: ImpactNode[] = [];
      for (const importer of importers) {
        if (!globalVisited.has(importer.file.path)) {
           flatAffectedFiles.add(importer.file.path);
           globalVisited.add(importer.file.path);
        }
        
        const childNodes = traverse('', importer.file.path, new Set(currentPathVisited));
        nodes.push({
          path: importer.file.path,
          importedNames: importer.importedNames,
          importers: childNodes
        });
      }
      return nodes;
    };

    const tree: ImpactNode[] = [];
    for (const origin of originFiles) {
       flatAffectedFiles.add(origin);
       globalVisited.add(origin);
       const nodes = traverse(symbol, origin, new Set());
       tree.push(...nodes);
    }

    return {
      originFiles,
      flatAffectedFiles: Array.from(flatAffectedFiles),
      tree
    };
  }

  findCircularDependencies(): string[][] {
    const circles: string[][] = [];
    
    for (const startPath of Object.keys(this.index.files)) {
      const visited = new Set<string>();
      const pathStack: string[] = [];

      const dfs = (currentPath: string) => {
        if (pathStack.includes(currentPath)) {
          const startIndex = pathStack.indexOf(currentPath);
          const circle = [...pathStack.slice(startIndex), currentPath];
          
          const normalized = circle.slice(0, -1).sort().join(' -> ');
          if (!circles.some(c => c.slice(0, -1).sort().join(' -> ') === normalized)) {
             circles.push(circle);
          }
          return;
        }

        if (visited.has(currentPath)) return;
        visited.add(currentPath);
        pathStack.push(currentPath);

        const file = this.index.files[currentPath];
        if (file && file.dependencies) {
          for (const dep of file.dependencies) {
            const matchedKey = Object.keys(this.index.files).find(k => this.matchPath(dep.path, k));
            if (matchedKey) {
              dfs(matchedKey);
            }
          }
        }

        pathStack.pop();
      };

      dfs(startPath);
    }
    
    return circles;
  }

  getArchitectureGraph() {
    const domains = {
      Pages: [] as string[],
      Components: [] as string[],
      API: [] as string[],
      ContextState: [] as string[],
      UtilsHooks: [] as string[],
      Other: [] as string[]
    };

    for (const file of Object.values(this.index.files)) {
      const p = file.path.toLowerCase();
      if (p.startsWith('app/') && p.includes('page.')) domains.Pages.push(file.path);
      else if (p.startsWith('components/') || p.startsWith('public-portal-components/components/')) domains.Components.push(file.path);
      else if (p.includes('route.') || p.startsWith('api/')) domains.API.push(file.path);
      else if (p.startsWith('context/') || p.startsWith('store/') || p.startsWith('public-portal-components/context/')) domains.ContextState.push(file.path);
      else if (p.startsWith('lib/') || p.startsWith('hooks/') || p.startsWith('utils/') || p.startsWith('public-portal-components/hooks/') || p.startsWith('public-portal-components/lib/')) domains.UtilsHooks.push(file.path);
      else domains.Other.push(file.path);
    }

    return domains;
  }

  getTopDependencies(limit: number = 15) {
    const counts: Record<string, number> = {};
    for (const file of Object.values(this.index.files)) {
      if (file.dependencies) {
        for (const dep of file.dependencies) {
           const matchedKey = Object.keys(this.index.files).find(k => this.matchPath(dep.path, k));
           if (matchedKey) {
              counts[matchedKey] = (counts[matchedKey] || 0) + 1;
           }
        }
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path, count]) => ({ path, count }));
  }
}
