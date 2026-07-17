import { Project, SyntaxKind } from 'ts-morph';
import path from 'path';

export interface ExtractedMetadata {
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
  components: { name: string; code: string; jsDocs: string }[] | string[];
  hooks: { name: string; code: string; jsDocs: string }[] | string[];
  functions: { name: string; code: string; jsDocs: string }[] | string[];
  functionCalls: { functionName: string; calls: string[] }[];
  types: string[];
}

export class ExtractorSkill {
  private project: Project;

  constructor(tsConfigFilePath?: string) {
    this.project = new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true, // Crucial for fast, isolated parsing
    });
  }

  extract(filePath: string): ExtractedMetadata | null {
    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const fileType = path.extname(filePath).replace('.', '');
      const loc = sourceFile.getEndLineNumber();

      // Next.js Awareness
      let nextjs: ExtractedMetadata['nextjs'] = undefined;
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.includes('/app/')) {
        const parts = normalizedPath.split('/app/')[1].split('/');
        const fileName = parts.pop() || '';
        
        if (['page.tsx', 'page.ts', 'layout.tsx', 'layout.ts', 'route.ts', 'route.js'].includes(fileName)) {
          let type: 'page' | 'layout' | 'api' = 'page';
          if (fileName.startsWith('layout')) type = 'layout';
          if (fileName.startsWith('route')) type = 'api';
          
          const routeSegments = parts;
          const route = '/' + routeSegments.join('/');
          nextjs = { route, routeSegments, type };
        }
      }

      // Dependencies
      const dependencies: ExtractedMetadata['dependencies'] = [];
      const allImportedNames: string[] = [];
      
      sourceFile.getImportDeclarations().forEach(imp => {
        const moduleSpecifier = imp.getModuleSpecifierValue();
        let resolvedPath = moduleSpecifier;
        
        if (moduleSpecifier.startsWith('.')) {
          const dir = path.dirname(filePath);
          const absPath = path.resolve(dir, moduleSpecifier);
          resolvedPath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');
        }

        const names: string[] = [];
        const defaultImport = imp.getDefaultImport();
        if (defaultImport) names.push(defaultImport.getText());
        
        imp.getNamedImports().forEach(ni => names.push(ni.getName()));
        
        const namespaceImport = imp.getNamespaceImport();
        if (namespaceImport) names.push(namespaceImport.getText());

        dependencies.push({ path: resolvedPath, importedNames: names });
        allImportedNames.push(...names);
      });

      // Symbol Categorization
      const components: any[] = [];
      const hooks: any[] = [];
      const functions: any[] = [];
      const types: string[] = [];
      const exportedSymbols: string[] = [];

      for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
        if (name === 'default') {
          if (declarations.length > 0 && (declarations[0] as any).getName) {
             const declName = (declarations[0] as any).getName();
             if (declName) exportedSymbols.push(declName);
             else exportedSymbols.push('default');
          } else {
             exportedSymbols.push('default');
          }
        } else {
          exportedSymbols.push(name);
        }
      }

      // Function Calls
      const functionCalls: ExtractedMetadata['functionCalls'] = [];

      const extractCalls = (node: any, name: string) => {
        const calls: string[] = [];
        node.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpr: any) => {
          const expression = callExpr.getExpression();
          calls.push(expression.getText());
        });
        if (calls.length > 0) {
           functionCalls.push({ functionName: name, calls: Array.from(new Set(calls)) });
        }
      };

      sourceFile.getFunctions().forEach(f => {
        const name = f.getName();
        if (!name) return;
        extractCalls(f, name);
        
        const code = f.getText();
        const jsDocs = f.getJsDocs().map(d => d.getText()).join('\n');
        
        if (name.startsWith('use')) hooks.push({ name, code, jsDocs });
        else if (name[0] === name[0].toUpperCase()) components.push({ name, code, jsDocs });
        else functions.push({ name, code, jsDocs });
      });

      sourceFile.getVariableDeclarations().forEach(v => {
        const name = v.getName();
        if (!name) return;
        const initializer = v.getInitializer();
        if (initializer && (initializer.getKindName() === 'ArrowFunction' || initializer.getKindName() === 'FunctionExpression')) {
          extractCalls(initializer, name);
          
          const code = v.getText();
          const varStatement = v.getVariableStatement();
          const jsDocs = varStatement ? varStatement.getJsDocs().map(d => d.getText()).join('\n') : '';

          if (name.startsWith('use')) hooks.push({ name, code, jsDocs });
          else if (name[0] === name[0].toUpperCase()) components.push({ name, code, jsDocs });
          else functions.push({ name, code, jsDocs });
        }
      });

      sourceFile.getInterfaces().forEach(i => types.push(i.getName()));
      sourceFile.getTypeAliases().forEach(t => types.push(t.getName()));

      this.project.removeSourceFile(sourceFile);

      return {
        fileType,
        loc,
        nextjs,
        dependencies,
        importedNames: Array.from(new Set(allImportedNames)),
        exportedSymbols: Array.from(new Set(exportedSymbols)),
        components: Array.from(new Set(components)),
        hooks: Array.from(new Set(hooks)),
        functions: Array.from(new Set(functions)),
        functionCalls,
        types: Array.from(new Set(types)),
      };
    } catch (e) {
      console.error(`Extractor failed for ${filePath}`, e);
      return null;
    }
  }
}
