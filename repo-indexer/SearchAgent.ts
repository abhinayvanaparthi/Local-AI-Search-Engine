import { SearchSkill, ImpactNode } from './SearchSkill';
import path from 'path';

function printHelp() {
  console.log(`
SearchAgent CLI - Query the Repo Index
======================================
Usage: npm run search -- [options]

Options:
  --find <term>       Broad search for a symbol, component, or file path.
  --who-uses <term>   Find all files that import the specified symbol/path.
  --route <route>     Find Next.js files associated with a URL route (e.g., /payments).
  --impact <term>     Generate a blast radius graph for changing the specified symbol.
  --find-circles      Scan the entire codebase for import loop circular dependencies.
  --architecture      Print a high-level summary of the codebase domains.
  --top-deps          Print the most imported foundational files in the project.
  --help              Show this help message.
`);
}

function printTree(nodes: ImpactNode[], depth: number = 0) {
  const indent = '  '.repeat(depth);
  for (const node of nodes) {
    const importsStr = node.importedNames.length > 0 ? ` (Imports: ${node.importedNames.join(', ')})` : '';
    console.log(`${indent}└─ \x1b[36m${node.path}\x1b[0m${importsStr}`);
    printTree(node.importers, depth + 1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    printHelp();
    return;
  }

  const workspaceRoot = path.resolve(__dirname, '../../');
  const indexPath = path.join(workspaceRoot, 'repo-index.json');
  
  let searchSkill: SearchSkill;
  try {
    searchSkill = new SearchSkill(indexPath);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--find') {
      const term = args[++i];
      if (!term) return console.error('Please provide a search term for --find');
      
      console.log(`\n\x1b[32mSearching for:\x1b[0m ${term}`);
      const results = searchSkill.find(term);
      console.log(`Found ${results.length} matches:\n`);
      results.forEach(r => console.log(` - \x1b[36m${r.path}\x1b[0m`));
    }
    
    else if (arg === '--who-uses') {
      const term = args[++i];
      if (!term) return console.error('Please provide a symbol for --who-uses');
      
      console.log(`\n\x1b[32mFinding importers of:\x1b[0m ${term}`);
      const results = searchSkill.whoUses(term);
      console.log(`Found ${results.length} importers:\n`);
      results.forEach(r => {
        const matches = r.matchedNames.length > 0 ? ` [${r.matchedNames.join(', ')}]` : '';
        console.log(` - \x1b[36m${r.file.path}\x1b[0m${matches}`);
      });
    }

    else if (arg === '--route') {
      const term = args[++i];
      if (!term) return console.error('Please provide a route for --route');
      
      console.log(`\n\x1b[32mFinding Next.js route:\x1b[0m ${term}`);
      const results = searchSkill.findRoute(term);
      console.log(`Found ${results.length} route files:\n`);
      results.forEach(r => {
        const routeInfo = r.nextjs ? ` (${r.nextjs.type}: ${r.nextjs.route})` : '';
        console.log(` - \x1b[36m${r.path}\x1b[0m${routeInfo}`);
      });
    }

    else if (arg === '--impact') {
      const term = args[++i];
      if (!term) return console.error('Please provide a symbol for --impact');
      
      console.log(`\n\x1b[32mCalculating Blast Radius for:\x1b[0m ${term}\n`);
      const result = searchSkill.getImpactGraph(term);
      
      console.log(`\x1b[33mOrigin Files:\x1b[0m`);
      result.originFiles.forEach(f => console.log(` \x1b[36m${f}\x1b[0m`));
      
      console.log(`\n\x1b[33mImpact Tree:\x1b[0m`);
      printTree(result.tree);
      
      console.log(`\n\x1b[33mFlat List of Affected Files (${result.flatAffectedFiles.length}):\x1b[0m`);
      result.flatAffectedFiles.forEach(f => console.log(` - ${f}`));
    }

    else if (arg === '--find-circles') {
      console.log(`\n\x1b[32mScanning for Circular Dependencies...\x1b[0m\n`);
      const circles = searchSkill.findCircularDependencies();
      if (circles.length === 0) {
         console.log(`\x1b[32mGreat news! No circular dependencies found.\x1b[0m`);
      } else {
         console.log(`\x1b[31mFound ${circles.length} Circular Dependencies:\x1b[0m`);
         circles.forEach((c, i) => console.log(` ${i + 1}. \x1b[36m${c.join(' \x1b[33m->\x1b[36m ')}\x1b[0m`));
      }
    }

    else if (arg === '--architecture') {
      console.log(`\n\x1b[32mGenerating High-Level Architecture Graph...\x1b[0m\n`);
      const graph = searchSkill.getArchitectureGraph();
      console.log(`\x1b[36mPages:\x1b[0m ${graph.Pages.length} files`);
      console.log(`\x1b[36mComponents:\x1b[0m ${graph.Components.length} files`);
      console.log(`\x1b[36mContext & State:\x1b[0m ${graph.ContextState.length} files`);
      console.log(`\x1b[36mAPI Routes:\x1b[0m ${graph.API.length} files`);
      console.log(`\x1b[36mUtils & Hooks:\x1b[0m ${graph.UtilsHooks.length} files`);
      console.log(`\x1b[36mOther/Config:\x1b[0m ${graph.Other.length} files`);
      console.log(`\n\x1b[33mTotal Tracked:\x1b[0m ${Object.values(graph).flat().length} files`);
    }

    else if (arg === '--top-deps') {
      console.log(`\n\x1b[32mTop Most-Imported Dependencies in Codebase:\x1b[0m\n`);
      const top = searchSkill.getTopDependencies();
      top.forEach((t, i) => console.log(` ${i + 1}. [${t.count} imports] \x1b[36m${t.path}\x1b[0m`));
    }
  }
}

main().catch(console.error);
