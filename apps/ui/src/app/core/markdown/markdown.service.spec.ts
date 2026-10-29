import { TestBed } from '@angular/core/testing';
import type { AttachmentMetadata } from '@glacier-tasks/domain';
import { MarkdownService } from './markdown.service';

let markdown: MarkdownService;

beforeEach(() => {
  markdown = TestBed.inject(MarkdownService);
});

function render(source: string, attachments: AttachmentMetadata[] = []): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = markdown.render(source, attachments);
  return container;
}

function attachment(id: string, previewable: boolean): AttachmentMetadata {
  return {
    id,
    taskId: 'task',
    originalName: `${id}.png`,
    mimeType: previewable ? 'image/png' : 'image/svg+xml',
    byteSize: 1,
    sha256: '0'.repeat(64),
    addedAt: '2026-10-29T10:00:00.000Z',
    removedAt: null,
    previewable,
  };
}

describe('MarkdownService (MD-01..05, T2)', () => {
  it('renders GFM: headings, emphasis, tables, fenced code and checklists', () => {
    const html = render(
      [
        '# Title',
        '',
        'Some **bold** and ~~gone~~ text.',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '```ts',
        'const x = 1 < 2;',
        '```',
        '',
        '- [x] done',
        '- [ ] open',
      ].join('\n'),
    );
    expect(html.querySelector('h1')?.textContent).toBe('Title');
    expect(html.querySelector('strong')?.textContent).toBe('bold');
    expect(html.querySelector('del')?.textContent).toBe('gone');
    expect(html.querySelectorAll('td').length).toBe(2);
    expect(html.querySelector('pre code')?.textContent).toContain('const x = 1 < 2;');
    const boxes = [...html.querySelectorAll('input')];
    expect(boxes.map((box) => [box.type, box.checked, box.disabled])).toEqual([
      ['checkbox', true, true],
      ['checkbox', false, true],
    ]);
  });

  it('shows raw HTML as text and never keeps scripts or handlers', () => {
    const html = render('<script>window.pwned = 1</script>\n\n<b onclick="x()">hi</b>');
    expect(html.querySelector('script')).toBeNull();
    expect(html.querySelector('b')).toBeNull();
    expect(html.textContent).toContain('<script>');
    expect(html.querySelector('[onclick]')).toBeNull();
  });

  it('keeps http(s) links for the OS browser and drops other schemes (MD-03)', () => {
    const html = render(
      '[web](https://example.com) [js](javascript:alert(1)) [file](file:///etc/passwd) [data](data:text/html,x)',
    );
    const links = [...html.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com',
      null,
      null,
      null,
    ]);
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('never loads images; attachment references become placeholders (D10, MD-05)', () => {
    const id = '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';
    const html = render(
      `![remote](https://example.com/x.png) ![inline](data:image/png;base64,AAAA) ![shot](attachment:${id})`,
    );
    expect(html.querySelector('img')).toBeNull();
    const placeholders = [...html.querySelectorAll('.md-image')] as HTMLElement[];
    expect(placeholders.map((p) => p.textContent)).toEqual(['remote', 'inline', 'shot']);
    expect(placeholders[2]?.dataset['attachmentId']).toBe(id);
    expect(placeholders[0]?.classList.contains('md-image-blocked')).toBe(true);
  });

  it('shows previewable attachments of this task inline and nothing else (D10, D33)', () => {
    const own = '0b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';
    const svg = '1b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';
    const other = '2b9e4a3e-6c1d-4f7a-9a51-2a8f3c5d7e10';
    const html = render(
      `![own](attachment:${own.toUpperCase()}) ![svg](attachment:${svg}) ![other](attachment:${other}) ![x](https://example.com/x.png)`,
      [attachment(own, true), attachment(svg, false)],
    );
    const images = [...html.querySelectorAll('img')];
    expect(images.map((img) => [img.getAttribute('src'), img.alt])).toEqual([
      [`glacier-media://attachment/${own}`, 'own'],
    ]);
    const placeholders = [...html.querySelectorAll('.md-image')].map((p) => p.textContent);
    expect(placeholders).toEqual(['svg', 'other', 'x']);
  });

  it('drops style and form elements written as Markdown-compatible HTML', () => {
    const html = render('<style>body{display:none}</style>\n\n<form><input type="text"></form>');
    expect(html.querySelector('style, form, input[type="text"]')).toBeNull();
  });
});
