import { Marked } from 'marked';

export const citationPolicy = 'markdown-body-labels@1';
const markdown = new Marked({ gfm: true, breaks: true });
const containers = new Set(['paragraph', 'heading', 'text', 'strong', 'em', 'del']);
const voidTags = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);

// This is a conservative Markdown label policy, not an HTML sanitizer, a DOM
// navigation map or a claim-support assessment. Never join text across markup.
export function bodyCitationLabels(text) {
  const labels = new Set();
  function visit(tokens) {
    const html = [];
    for (const token of tokens || []) {
      if (token.type === 'html') {
        // Block HTML is opaque. Inline HTML contents are excluded, including
        // nested tags; an unclosed tag excludes the rest of this token sequence.
        if (!token.block) {
          const tag = token.raw.match(/^<(\/?)([a-z][a-z0-9:-]*)\b/i);
          if (tag) {
            const name = tag[2].toLowerCase();
            if (tag[1]) {
              const index = html.lastIndexOf(name);
              if (index >= 0) html.splice(index);
            } else if (!voidTags.has(name) && !/\/>\s*$/.test(token.raw)) html.push(name);
          }
        }
        continue;
      }
      if (html.length) continue;
      if (containers.has(token.type)) {
        if (token.tokens) visit(token.tokens);
        else if (token.type === 'text')
          for (const match of token.text.matchAll(/\[(R\d+)\]/g)) labels.add(match[1]);
      } else if (token.type === 'list') {
        for (const item of token.items) visit(item.tokens);
      } else if (token.type === 'table') {
        for (const cell of [...token.header, ...token.rows.flat()]) visit(cell.tokens);
      }
      // Code/codespan, blockquote, link/image, escape, definitions and unknown
      // tokens are deliberately opaque; none can attest a body citation.
    }
  }
  visit(markdown.lexer(text));
  return [...labels];
}
