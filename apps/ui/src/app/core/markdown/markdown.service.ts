import { Injectable } from '@angular/core';
import DOMPurify, { type Config } from 'dompurify';
import { Marked, type Tokens } from 'marked';
import { type AttachmentMetadata, attachmentUrl } from '@glacier-tasks/domain';

/** `attachment:<uuid>` references a file of the same task (D10). */
const ATTACHMENT_SRC =
  /^attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const EXTERNAL_HREF = /^https?:\/\//i;

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'a',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
    'input',
    'li',
    'ol',
    'p',
    'pre',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'type', 'checked', 'disabled', 'align', 'start'],
  // http(s) links and same-task attachment images only; everything else is dropped.
  ALLOWED_URI_REGEXP: /^(?:https?:\/\/|attachment:)/i,
  // Plain-value attributes; without this DOMPurify checks them against the URI pattern.
  ADD_URI_SAFE_ATTR: ['type', 'checked', 'disabled', 'align', 'start'],
  ALLOW_DATA_ATTR: false,
  RETURN_DOM_FRAGMENT: true,
};

/**
 * Renders task descriptions (MD-01..05, D10, threat model T2): GitHub-flavoured Markdown via
 * `marked`, raw HTML shown as text, then DOMPurify with a strict allow-list. Links open only
 * on click and only in the OS browser (via the main process' window-open handler); images
 * other than same-task attachments are never loaded. The source text is never rewritten.
 */
@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private readonly marked = new Marked({ gfm: true, async: false }).use({
    renderer: {
      // MD-04: no embedded HTML. Show it as text instead of dropping it silently.
      html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text),
    },
  });
  private readonly purify = DOMPurify(window);

  /**
   * `attachments` are the live attachments of the task being shown. Only those that are
   * previewable become images (D10, D33); any other reference stays a placeholder.
   */
  render(source: string, attachments: ReadonlyArray<AttachmentMetadata> = []): string {
    const previewable = new Set(attachments.filter((a) => a.previewable).map((a) => a.id));
    const html = this.marked.parse(source) as string;
    const fragment = this.purify.sanitize(html, PURIFY_CONFIG) as unknown as DocumentFragment;
    for (const link of fragment.querySelectorAll('a')) hardenLink(link);
    for (const input of fragment.querySelectorAll('input')) hardenCheckbox(input);
    for (const image of fragment.querySelectorAll('img')) replaceImage(image, previewable);
    const container = document.createElement('div');
    container.append(fragment);
    return container.innerHTML;
  }
}

function hardenLink(link: HTMLAnchorElement): void {
  const href = link.getAttribute('href');
  if (!href || !EXTERNAL_HREF.test(href)) {
    link.removeAttribute('href');
    return;
  }
  // target=_blank reaches setWindowOpenHandler, which hands http(s) to the OS browser.
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
}

/** D10: task-list checkboxes are read-only; other inputs never survive. */
function hardenCheckbox(input: HTMLInputElement): void {
  if (input.getAttribute('type') !== 'checkbox') {
    input.remove();
    return;
  }
  input.setAttribute('disabled', '');
}

/**
 * MD-05: a previewable attachment of the same task becomes an image served by the media
 * protocol. Every other image is never fetched: unknown or non-previewable attachment
 * references become a labelled placeholder, any other source is reduced to its alt text.
 */
function replaceImage(image: HTMLImageElement, previewable: ReadonlySet<string>): void {
  const attachment = ATTACHMENT_SRC.exec(image.getAttribute('src') ?? '');
  const id = attachment ? (attachment[1] as string).toLowerCase() : null;
  if (id && previewable.has(id)) {
    const inline = document.createElement('img');
    inline.className = 'md-attachment';
    inline.src = attachmentUrl(id);
    inline.alt = image.getAttribute('alt') ?? '';
    inline.loading = 'lazy';
    image.replaceWith(inline);
    return;
  }
  const placeholder = document.createElement('span');
  placeholder.className = 'md-image';
  if (id) placeholder.dataset['attachmentId'] = id;
  else placeholder.classList.add('md-image-blocked');
  placeholder.textContent = image.getAttribute('alt') || image.getAttribute('src') || '';
  image.replaceWith(placeholder);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
