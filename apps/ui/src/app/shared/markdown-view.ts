import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  ViewEncapsulation,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { AttachmentMetadata } from '@glacier-tasks/domain';
import { MarkdownService } from '../core/markdown/markdown.service';

/**
 * Rendered Markdown. The HTML comes exclusively from MarkdownService, whose DOMPurify pass is
 * the sanitizer of record (threat model T2); Angular's own sanitizer would strip the
 * read-only checklist inputs, so the output is marked trusted here and nowhere else.
 */
@Component({
  selector: 'app-markdown-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Rendered HTML carries no Angular style scoping attributes, so these rules are global but
  // confined to `app-markdown-view .markdown` (which also outranks form rules like `.field input`).
  encapsulation: ViewEncapsulation.None,
  template: `<div class="markdown" [innerHTML]="html()"></div>`,
  styles: `
    app-markdown-view .markdown {
      overflow-wrap: anywhere;
      line-height: 1.55;

      > :first-child {
        margin-top: 0;
      }
      > :last-child {
        margin-bottom: 0;
      }
      h1,
      h2,
      h3,
      h4 {
        margin: 1.1em 0 0.5em;
        line-height: 1.25;
      }
      h1 {
        font-size: 1.5em;
      }
      h2 {
        font-size: 1.3em;
      }
      h3 {
        font-size: 1.15em;
      }
      p,
      ul,
      ol,
      pre,
      table,
      blockquote {
        margin: 0 0 0.8em;
      }
      ul,
      ol {
        padding-left: 1.5em;
      }
      li:has(> input[type='checkbox']) {
        list-style: none;
        margin-left: -1.3em;
      }
      input[type='checkbox'] {
        width: auto;
        margin: 0 0.5em 0 0;
        vertical-align: middle;
      }
      code {
        padding: 0.1em 0.35em;
        border-radius: var(--radius-sm);
        background-color: var(--color-bg);
        font-family: var(--font-mono);
        font-size: 0.92em;
      }
      pre {
        overflow-x: auto;
        padding: 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background-color: var(--color-bg);

        code {
          padding: 0;
          background: none;
        }
      }
      blockquote {
        padding-left: 12px;
        border-left: 3px solid var(--color-border);
        color: var(--color-text-muted);
      }
      table {
        border-collapse: collapse;
      }
      th,
      td {
        padding: 6px 10px;
        border: 1px solid var(--color-border);
      }
      hr {
        border: 0;
        border-top: 1px solid var(--color-border);
      }
      .md-attachment {
        max-width: 100%;
        max-height: 480px;
        border-radius: var(--radius-sm);
      }
      .md-image {
        display: inline-block;
        padding: 2px 8px;
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        font-size: 0.9em;
      }
    }
  `,
})
export class MarkdownView {
  private readonly markdown = inject(MarkdownService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly source = input.required<string>();
  /** Live attachments of the task being shown; previewable ones render inline (D10). */
  readonly attachments = input<ReadonlyArray<AttachmentMetadata>>([]);
  protected readonly html = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.markdown.render(this.source(), this.attachments())),
  );
}
