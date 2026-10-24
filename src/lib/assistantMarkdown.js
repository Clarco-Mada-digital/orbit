import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { safeHref } from './markdown.js';

export const assistantRemarkPlugins = [remarkGfm, remarkMath];
export const assistantRehypePlugins = [[rehypeKatex, { throwOnError: false }]];

export function transformAssistantMarkdownUrl(value) {
  return safeHref(value) || '';
}
