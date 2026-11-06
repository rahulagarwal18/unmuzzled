import { Marked } from "/vendor/marked/marked.esm.js";
import hljs from "/vendor/hljs/es/highlight.min.js";

const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => entities[c]);

const safeHref = (href) => (/^(https?:|mailto:|#)/i.test(href ?? "") ? href : null);

const marked = new Marked({
  gfm: true,
  renderer: {
    // Model output is untrusted: show raw HTML as text instead of rendering it.
    html({ text }) {
      return escapeHtml(text);
    },

    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
      const known = language && hljs.getLanguage(language);
      const body = known
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escapeHtml(text);
      return (
        `<div class="code">` +
          `<div class="code-head"><span>${escapeHtml(language || "text")}</span>` +
            `<button class="code-copy" type="button" data-copy-code>` +
              `<svg class="i"><use href="#i-copy"/></svg><span>Copy</span>` +
            `</button>` +
          `</div>` +
          `<pre><code class="hljs">${body}</code></pre>` +
        `</div>`
      );
    },

    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const url = safeHref(href);
      if (!url) return text;
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(url)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },

    // Don't let responses load remote images; the app is meant to stay offline.
    image({ href, text }) {
      return `<span class="img-ref">[image: ${escapeHtml(text || href)}]</span>`;
    },
  },
});

export function renderMarkdown(source) {
  return marked.parse(source ?? "");
}
