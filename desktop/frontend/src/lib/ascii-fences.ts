/** Box-drawing / arrow-heavy fences that should not go through Shiki. */
export function looksLikeAsciiArt(body: string): boolean {
  const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 3) return false;
  if (/[┌┐└┘├┤┬┴┼─│═║╔╗╚╝▶▼▲◄►←→↑↓]/.test(body)) return true;
  // Classic pure-ASCII diagrams: lots of | + - / corners.
  const joints = (body.match(/[+\-|\\/]{2,}/g) || []).length;
  const pipeLines = lines.filter((line) => /\|/.test(line) || /\+[-+]+\+/.test(line)).length;
  return joints >= 4 && pipeLines >= 3;
}

/**
 * Rewrite bare / text / ascii fences that look like diagrams so Streamdown
 * routes them to the AsciiDiagram renderer instead of a monochrome code block.
 */
export function promoteAsciiFences(markdown: string): string {
  return markdown.replace(/(^|\n)```([^\n`]*)\n([\s\S]*?)\n```(?=\n|$)/g, (full, lead, info, body) => {
    const token = String(info || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
    if (token && !["text", "ascii", "plain", "plaintext", "diagram"].includes(token)) {
      return full;
    }
    if (!looksLikeAsciiArt(body)) return full;
    return `${lead}\`\`\`ascii\n${body}\n\`\`\``;
  });
}
