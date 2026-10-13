import { lastReply, type Task } from '../checks';

/*
 * Step 0, E0.3: the paper's sustained-load test on this phone. One long essay,
 * repeated back to back with no cool-down (choose "Back to back", temperature
 * 0 and 20 repeats), to see peak against plateau speed as the phone heats.
 * The prompt is the paper's (arXiv 2603.23640, section 3.2).
 */

const ESSAY = `Write an in-depth, structured, and self-contained essay explaining the concept of consciousness from multiple perspectives. Begin by clearly defining consciousness and why it is a difficult concept to study. Then explore the topic from the following viewpoints, dedicating multiple detailed paragraphs to each:
1. Philosophical perspectives, including classical and modern views, major debates, and unresolved questions.
2. Neuroscientific perspectives, covering brain structures, neural correlates, current theories, and experimental approaches.
3. Cognitive science and psychology perspectives, including perception, attention, self-awareness, and consciousness disorders.
4. Artificial intelligence and machine consciousness, discussing whether machines can be conscious, functional vs. phenomenal consciousness, and current limitations of AI systems.
5. Ethical and societal implications of understanding or engineering consciousness.
Throughout the essay: use clear section headings; explain all technical terms in plain language; provide illustrative examples where helpful; compare and contrast different viewpoints; avoid bullet lists unless necessary for clarity. Conclude with a reflective summary discussing what remains unknown and what future research directions may look like. The response should be detailed, continuous, and written in a neutral, academic tone.`;

export const SUSTAINED_SUITE: Task[] = [
  {
    id: 'consciousness-essay',
    title: 'Long essay (the paper’s prompt)',
    needsTools: false,
    turns: [ESSAY],
    // Quality isn't the point here; check it actually wrote an essay.
    check: (run) => {
      const words = lastReply(run).split(/\s+/).filter(Boolean).length;
      return words >= 300 ? { pass: true, detail: `${words} words` } : { pass: false, detail: `only ${words} words` };
    },
  },
];
