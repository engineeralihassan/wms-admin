import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  buildAcceptAttribute,
  describeAllowedTypes,
  formatFileSize,
  validateFiles,
  type FileUploadConfig,
  type RejectedFile,
  type SelectedFile,
} from './file-upload.model';

/**
 * Reusable, presentational file picker with drag-and-drop, config-driven validation
 * (allowed types, size cap, max count), and clear per-file + batch error messages.
 *
 * It is intentionally STORAGE-AGNOSTIC: it only manages selection + validation and
 * emits the selected files. The parent decides how to persist them (send names now;
 * upload to S3 via presigned URLs later) — so this component never changes when the
 * backend storage strategy does.
 *
 * Usage:
 *   <app-file-upload
 *     [config]="{ accept: ['image','pdf','excel','csv','doc'], maxSizeBytes: mb(3), maxFiles: 3 }"
 *     (filesChange)="attachments.set($event)"
 *   />
 */
@Component({
  selector: 'app-file-upload',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-upload.component.html',
  styleUrl: './file-upload.component.scss',
})
export class FileUploadComponent {
  /** Validation + behavior config. */
  readonly config = input.required<FileUploadConfig>();
  /** Optional label shown above the dropzone. */
  readonly label = input('Attachments');
  /** Disable the whole control. */
  readonly disabled = input(false);

  /** Emits the current valid selection (rich objects) whenever it changes. */
  readonly filesChange = output<SelectedFile[]>();
  /** Emits just the raw File[] (convenience for multipart consumers). */
  readonly rawFilesChange = output<File[]>();

  protected readonly selected = signal<SelectedFile[]>([]);
  protected readonly errors = signal<RejectedFile[]>([]);
  protected readonly isDragging = signal(false);

  protected readonly acceptAttr = computed(() => buildAcceptAttribute(this.config().accept));
  protected readonly allowedLabel = computed(() => describeAllowedTypes(this.config().accept));
  protected readonly maxSizeLabel = computed(() => formatFileSize(this.config().maxSizeBytes));
  protected readonly canAddMore = computed(() => this.selected().length < this.config().maxFiles);
  protected readonly allowMultiple = computed(
    () => this.config().multiple ?? this.config().maxFiles > 1,
  );

  protected readonly formatFileSize = formatFileSize;

  // ---- Selection handlers ----
  protected onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files));
    // Reset so picking the same file again re-triggers change.
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    if (this.disabled()) return;
    const files = event.dataTransfer?.files;
    if (files && files.length) this.addFiles(Array.from(files));
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.disabled()) this.isDragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  protected remove(id: string): void {
    this.selected.update((list) => list.filter((f) => f.id !== id));
    this.emit();
  }

  protected clearErrors(): void {
    this.errors.set([]);
  }

  private addFiles(incoming: File[]): void {
    if (this.disabled()) return;
    const { accepted, rejected } = validateFiles(this.selected(), incoming, this.config());
    if (accepted.length) {
      this.selected.update((list) => [...list, ...accepted]);
      this.emit();
    }
    this.errors.set(rejected);
  }

  private emit(): void {
    const list = this.selected();
    this.filesChange.emit(list);
    this.rawFilesChange.emit(list.map((f) => f.file));
  }

  /** Public reset so parents can clear the control after a successful submit. */
  reset(): void {
    this.selected.set([]);
    this.errors.set([]);
    this.emit();
  }
}
