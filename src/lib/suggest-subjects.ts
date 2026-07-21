// AI subject suggestions (server-only). Given a fragment's text + the CURRENT
// taxonomy (names + definitions, read live from the DB by the caller), ask Claude
// which existing subjects apply (0–3) and, only when nothing fits, to propose ONE
// new subject. Structured output (zodOutputFormat) guarantees the shape; the enum
// pins existing picks to the real taxonomy. Human stays in the loop — the caller
// pre-fills the tag input and requires an explicit accept for a proposal. Never
// imported client-side (it holds the API key path).
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'astro/zod';

export interface TaxonomyEntry {
  name: string;
  definition: string | null;
}

export interface SubjectSuggestion {
  existing: string[];
  proposed: { name: string; definition: string } | null;
}

const SYSTEM = (kind: string, list: string) =>
  `You tag a ${kind} for a personal blog with subjects from a fixed taxonomy.\n\n` +
  `Pick ONLY subjects below that the piece is genuinely about — prefer fewer, precise tags, ` +
  `at most 3. Do not stretch a weak thematic connection. Return their exact names in "applicable".\n\n` +
  `Propose a new subject (name + a one-line definition matching the style below) ONLY if the piece ` +
  `has a clear central theme that no existing subject covers; otherwise set "new_subject" to null. ` +
  `Strongly prefer existing subjects.\n\nTaxonomy:\n${list}`;

export async function suggestSubjects(
  text: string,
  kind: 'quote' | 'song' | 'writing',
  apiKey: string,
  taxonomy: TaxonomyEntry[],
): Promise<SubjectSuggestion> {
  const names = taxonomy.map((t) => t.name);
  if (!names.length) return { existing: [], proposed: null };

  const Suggestion = z.object({
    applicable: z.array(z.enum(names as [string, ...string[]])).describe('Existing subjects that genuinely apply (0–3).'),
    new_subject: z
      .object({ name: z.string(), definition: z.string() })
      .nullable()
      .describe('A proposed NEW subject, or null when an existing one already fits.'),
  });

  const client = new Anthropic({ apiKey });
  const list = taxonomy.map((t) => `- ${t.name}: ${t.definition ?? '(no definition yet)'}`).join('\n');
  const message = await client.messages.parse({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SYSTEM(kind, list),
    messages: [{ role: 'user', content: text }],
    output_config: { format: zodOutputFormat(Suggestion) },
  });
  const out = message.parsed_output ?? { applicable: [], new_subject: null };
  return { existing: out.applicable.slice(0, 3), proposed: out.new_subject };
}
