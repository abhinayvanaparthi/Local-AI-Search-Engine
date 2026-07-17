import { GoogleGenAI } from '@google/genai';

export class SummarizerSkill {
  private ai: GoogleGenAI;
  private hasKey: boolean;

  constructor() {
    this.hasKey = !!process.env.GEMINI_API_KEY;
    if (this.hasKey) {
      this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else {
      this.ai = new GoogleGenAI({ apiKey: 'dummy' });
    }
  }

  async summarize(
    filePath: string,
    fileType: string,
    imports: string[],
    exports: string[],
    snippet: string
  ): Promise<string> {
    if (!this.hasKey) {
      console.warn(`[SummarizerSkill] No GEMINI_API_KEY found. Skipping for ${filePath}`);
      return "Placeholder summary: AI generation skipped due to missing API key.";
    }

    const prompt = `
You are an expert Next.js and TypeScript developer.
Provide a concise 1-2 sentence summary of the purpose of the following file based on its metadata and snippet.
Do not describe the imports or exports literally. Describe the architectural role of the file (e.g., "A Next.js server component that renders the user dashboard").

File Path: ${filePath}
File Type: ${fileType}
Imports: ${imports.join(', ')}
Exports: ${exports.join(', ')}

Snippet:
\`\`\`typescript
${snippet.substring(0, 1000)}
\`\`\`
`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });

      return response.text?.trim() || "Generated empty summary.";
    } catch (e) {
      console.error(`[SummarizerSkill] Failed to summarize ${filePath}`, e);
      return "Error generating summary.";
    }
  }
}
