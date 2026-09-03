import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  forwardRef,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Reusable, dependency-free rich-text editor built on a contenteditable surface plus a
 * compact formatting toolbar. Implemented as a ControlValueAccessor so it drops into
 * reactive forms exactly like a native input:
 *
 *   <app-rich-text-editor formControlName="description" />
 *
 * Why no library: the app is intentionally lean (zoneless Angular, signals). This gives
 * full control over markup + styling with zero added bundle weight. The produced HTML is
 * a simple, well-formed subset (formatBlock/bold/italic/lists/links); the BACKEND
 * sanitizes it to a safe allow-list before storing, and rendering uses Angular's
 * auto-sanitizing [innerHTML], so we never trust this markup blindly.
 *
 * Accessibility: the toolbar buttons are real <button>s with titles/aria-labels; the
 * editable region is a labelled textbox (role=textbox, aria-multiline).
 */
type Command =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'insertUnorderedList'
  | 'insertOrderedList';

@Component({
  selector: 'app-rich-text-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditorComponent),
      multi: true,
    },
  ],
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss',
})
export class RichTextEditorComponent implements ControlValueAccessor {
  readonly placeholder = input('Write a description…');
  readonly minHeight = input(220);

  private readonly editor = viewChild.required<ElementRef<HTMLDivElement>>('editor');

  /** True while the editable region has no visible content (drives the placeholder). */
  protected readonly isEmpty = signal(true);
  protected readonly disabled = signal(false);
  /** Live snapshot of which inline formats are active at the caret (toolbar highlight). */
  protected readonly active = signal<Record<string, boolean>>({});

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  // ── ControlValueAccessor ─────────────────────────────────────────────────
  writeValue(value: string | null): void {
    const html = value ?? '';
    // Defer until the view exists (viewChild.required is available after init).
    queueMicrotask(() => {
      const el = this.editor().nativeElement;
      el.innerHTML = html;
      this.isEmpty.set(this.computeEmpty(el));
    });
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  protected onInput(): void {
    const el = this.editor().nativeElement;
    const empty = this.computeEmpty(el);
    this.isEmpty.set(empty);
    // Emit '' when empty so `Validators.required` on the bound control trips correctly.
    this.onChange(empty ? '' : el.innerHTML);
    this.refreshActive();
  }

  protected onBlur(): void {
    this.onTouched();
  }

  /** Apply an execCommand-style inline/block format, then re-focus the editor. */
  protected exec(command: Command, event: Event): void {
    event.preventDefault();
    if (this.disabled()) return;
    this.editor().nativeElement.focus();
    document.execCommand(command, false);
    this.onInput();
  }

  /** Toggle a block format (paragraph / heading) at the caret. */
  protected format(block: 'p' | 'h2' | 'h3', event: Event): void {
    event.preventDefault();
    if (this.disabled()) return;
    this.editor().nativeElement.focus();
    document.execCommand('formatBlock', false, block);
    this.onInput();
  }

  /** Prompt for a URL and wrap the current selection in a link. */
  protected addLink(event: Event): void {
    event.preventDefault();
    if (this.disabled()) return;
    const url = window.prompt('Link URL (https://…)');
    if (!url) return;
    // Basic guard: only allow http/https/mailto links from the UI (backend re-checks).
    if (!/^(https?:|mailto:)/i.test(url)) {
      window.alert('Please enter a valid http(s) or mailto link.');
      return;
    }
    this.editor().nativeElement.focus();
    document.execCommand('createLink', false, url);
    this.onInput();
  }

  protected removeLink(event: Event): void {
    event.preventDefault();
    if (this.disabled()) return;
    this.editor().nativeElement.focus();
    document.execCommand('unlink', false);
    this.onInput();
  }

  /** Clear all formatting from the current selection. */
  protected clearFormat(event: Event): void {
    event.preventDefault();
    if (this.disabled()) return;
    this.editor().nativeElement.focus();
    document.execCommand('removeFormat', false);
    document.execCommand('formatBlock', false, 'p');
    this.onInput();
  }

  /**
   * Paste as PLAIN TEXT. contenteditable would otherwise inject arbitrary markup from
   * the clipboard (Word/Google Docs), which we don't want; the toolbar is the only way
   * to add formatting. Keeps the stored HTML clean and predictable.
   */
  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
    this.onInput();
  }

  protected refreshActive(): void {
    // queryCommandState reflects the caret's current inline formats.
    try {
      this.active.set({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
      });
    } catch {
      // queryCommandState can throw in rare states; ignore (toolbar just won't highlight).
    }
  }

  /** True when the editable region has no meaningful text/markup. */
  private computeEmpty(el: HTMLElement): boolean {
    const text = (el.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    if (text.length > 0) return false;
    // Also treat an editor that only contains empty block tags as empty.
    return !/<(img|hr|br)\b/i.test(el.innerHTML);
  }
}
