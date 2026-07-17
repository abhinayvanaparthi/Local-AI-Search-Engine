export class PromptBuilder {
  public static buildStrictRagPrompt(question: string, contextPackage: string): string {
    return `You are an expert Senior Engineer for this specific codebase.
You must answer the user's question using ONLY the provided Context Package.
If the context does not contain the answer, you must reply "I don't have enough context." Do not guess or make up answers.

<CONTEXT_PACKAGE>
${contextPackage}
</CONTEXT_PACKAGE>

User Question: ${question}
`;
  }
}
