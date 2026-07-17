import fs from 'fs';
import readline from 'readline';
import path from 'path';

interface Metrics {
  totalSteps: number;
  toolUsage: Record<string, number>;
  estimatedTokens: number;
  totalTimeMs?: number;
}

async function analyzeLog(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const metrics: Metrics = {
    totalSteps: 0,
    toolUsage: {},
    estimatedTokens: 0,
  };

  let totalChars = 0;

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      // We only care about model steps for reasoning metrics
      if (entry.source === 'MODEL' || entry.type?.includes('RESPONSE')) {
        metrics.totalSteps++;
        
        if (entry.content) {
          totalChars += entry.content.length;
        }

        if (entry.tool_calls && Array.isArray(entry.tool_calls)) {
          for (const tool of entry.tool_calls) {
            const name = tool.name || tool.tool_name || 'unknown_tool';
            metrics.toolUsage[name] = (metrics.toolUsage[name] || 0) + 1;
            
            if (tool.arguments) {
              totalChars += JSON.stringify(tool.arguments).length;
            }
          }
        }
      } else if (entry.source === 'USER_EXPLICIT' && entry.content) {
        totalChars += entry.content.length;
      }

    } catch (e) {
      console.error("Failed to parse line:", line.substring(0, 50) + "...");
    }
  }

  // Rough estimation: 4 chars per token
  metrics.estimatedTokens = Math.round(totalChars / 4);

  console.log(`\n\x1b[36m📊 Metrics Analysis for: ${path.basename(path.dirname(filePath))}\x1b[0m\n`);
  console.log(`Total Model Reasoning Steps: ${metrics.totalSteps}`);
  console.log(`Estimated Tokens Processed: ~${metrics.estimatedTokens.toLocaleString()}`);
  
  console.log(`\n🛠️  Tool Usage Breakdown:`);
  if (Object.keys(metrics.toolUsage).length === 0) {
    console.log(`  None (0 tools used)`);
  } else {
    for (const [tool, count] of Object.entries(metrics.toolUsage)) {
      console.log(`  - ${tool}: ${count}`);
    }
  }
  console.log('\n');
}

const targetPath = process.argv[2];
if (!targetPath) {
  console.log("Usage: npx tsx MetricsAnalyzer.ts <path-to-transcript.jsonl>");
  process.exit(1);
}

analyzeLog(targetPath).catch(console.error);
