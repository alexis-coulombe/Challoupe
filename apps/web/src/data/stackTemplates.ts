import type { StackTemplate } from '../models/StackTemplate';
import templates from './stackTemplates.json';

export type { StackTemplate };

interface RawTemplate extends Omit<StackTemplate, 'compose'> {
  compose: string[];
}

// The catalog lives in stackTemplates.json (plain data, easy to extend without touching
// TS). Its "compose" is one array entry per line rather than one \n-escaped blob, so the
// YAML stays readable and diffable straight in the JSON file; join it back into a single
// string here, the shape every consumer actually wants.
export const STACK_TEMPLATES: StackTemplate[] = (templates as RawTemplate[]).map((t) => ({
  ...t,
  compose: t.compose.join('\n') + '\n',
}));
