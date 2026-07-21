// The canonical subject taxonomy (names + definitions), shared by the AI
// subject-suggester and anything else that needs the vocabulary with meaning.
// Source of truth is scripts/reflections-subjects.json — the same file the
// import scripts feed. Keep new/accepted subjects there so there's one list.
import taxonomyJson from '../../scripts/reflections-subjects.json';

export interface Subject {
  name: string;
  definition: string;
}

export const taxonomy: Subject[] = taxonomyJson.taxonomy;
export const SUBJECT_NAMES: string[] = taxonomy.map((t) => t.name);
