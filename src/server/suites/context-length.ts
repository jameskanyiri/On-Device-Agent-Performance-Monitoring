import { replyMatches, type Task } from '../checks';

/*
 * Step 0, E0.2: what each extra token of context costs (reading time, memory,
 * heat) and whether the answer survives it. The same question after about
 * 250 / 500 / 1,000 / 1,500 tokens of notes, the answer hidden in the middle.
 * Kept under 2,048 tokens (Gemma 4's window here) with room for the reply.
 */

const TOPICS = ['garden', 'car service', 'school fees', 'book club', 'gym', 'groceries', 'rent', 'holiday', 'dentist', 'internet', 'birthday', 'plumber'];
const NEEDLE = '- The agreed marketing budget for Q4 is $4,200 (owner: Wanjiru).';

/** Filler notes of about `tokens` tokens (≈ 4 characters per token), deterministic. */
function filler(tokens: number): string[] {
  const lines: string[] = [];
  let chars = 0;
  for (let i = 0; chars < tokens * 4; i++) {
    const topic = TOPICS[i % TOPICS.length]!;
    const line = `- Note ${i + 1} (${topic}): remember to follow up on the ${topic} on day ${(i * 7) % 28 + 1}; it costs about ${(i * 37) % 900 + 100} shillings.`;
    lines.push(line);
    chars += line.length + 1;
  }
  return lines;
}

function task(tokens: number): Task {
  const lines = filler(tokens);
  lines.splice(Math.floor(lines.length / 2), 0, NEEDLE);
  return {
    id: `context-${tokens}`,
    title: `About ${tokens.toLocaleString('en')} tokens of notes`,
    needsTools: false,
    turns: [`Here are my notes:\n\n${lines.join('\n')}\n\nWhat is the agreed marketing budget for Q4? Answer in one sentence.`],
    check: (run) => replyMatches(run, /4,?200/),
  };
}

export const CONTEXT_LENGTH_SUITE: Task[] = [250, 500, 1000, 1500].map(task);
