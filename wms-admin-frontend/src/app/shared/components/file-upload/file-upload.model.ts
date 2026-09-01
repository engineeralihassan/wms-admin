/**
 * Reusable file-upload system — types, presets, and pure validation.
 *
 * Design goals (senior-level, future-proof):
 *  - The UPLOAD MECHANISM is decoupled from SELECTION + VALIDATION. This component
 *    only selects and validates files and hands back a clean list. How the bytes get
 *    persisted (multipart now, S3 presigned URLs later) is the CONSUMER's concern —
 *    swap the persistence strategy without touching this component.
 *  - Everything is CONFIG-DRIVEN: allowed types, size cap, and file count are inputs,
 *    so the same component serves ticket attachments, avatars, imports, etc.
 *  - Type rules are declared by high-level PRESET keys ('image', 'pdf', …) rather than
 *    raw MIME strings, so consumers stay readable and rules live in one place.
 */

/** High-level categories a consumer can allow. */
export type FileTypePreset = 'image' | 'pdf' | 'excel' | 'csv' | 'doc';

/** A single allowed type: its accepted extensions + MIME types (for matching + the accept attr). */
interface FileTypeRule {
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
}

/**
 * Central catalog of allowed file types. Add a preset here and every uploader can use
 * it. We match on BOTH extension and MIME because browsers/OSes report MIME
 * inconsistently (e.g. csv is sometimes text/plain, xlsx sometimes octet-stream).
 */
export const FILE_TYPE_PRESETS: Record<FileTypePreset, FileTypeRule> = {
  image: {
    label: 'Images',
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  },
  pdf: {
    label: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
  },
  excel: {
    label: 'Excel',
    extensions: ['.xls', '.xlsx'],
    mimeTypes: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },
  csv: {
    label: 'CSV',
    extensions: ['.csv'],
    mimeTypes: ['text/csv', 'application/csv', 'text/plain'],
  },
  doc: {
    label: 'Word',
    extensions: ['.doc', '.docx'],
    mimeTypes: [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
};

/** Configuration a consumer passes to the uploader. */
export interface FileUploadConfig {
  /** Which type presets are allowed. */
  accept: readonly FileTypePreset[];
  /** Max size per file, in bytes. */
  maxSizeBytes: number;
  /** Max number of files that can be selected in total. */
  maxFiles: number;
  /** Allow selecting more than one file at once. Defaults to maxFiles > 1. */
  multiple?: boolean;
}

/** Why a specific file was rejected. */
export type FileRejectionReason = 'type' | 'size' | 'duplicate' | 'maxFiles';

/** A file that passed selection, tracked in the UI with a stable id + status. */
export interface SelectedFile {
  /** Stable client id for tracking/removal (not persisted). */
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  /** Future-proofing: upload lifecycle. For now everything is 'ready'. */
  status: 'ready' | 'uploading' | 'uploaded' | 'error';
}

/** A file that was rejected during selection, with a human-readable reason. */
export interface RejectedFile {
  name: string;
  reason: FileRejectionReason;
  message: string;
}

/** Result of validating a batch of newly-picked files against the config + existing set. */
export interface FileValidationResult {
  accepted: SelectedFile[];
  rejected: RejectedFile[];
}

const BYTES_PER_MB = 1024 * 1024;

/** Format a byte count as a compact human string (e.g. "2.4 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/** Convenience: build a byte cap from MB. */
export function mb(value: number): number {
  return Math.round(value * BYTES_PER_MB);
}

/** The extension of a filename, lowercased, including the dot (or '' if none). */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

/** Build the HTML input `accept` attribute value from the allowed presets. */
export function buildAcceptAttribute(accept: readonly FileTypePreset[]): string {
  const parts = new Set<string>();
  for (const key of accept) {
    const rule = FILE_TYPE_PRESETS[key];
    rule.extensions.forEach((e) => parts.add(e));
    rule.mimeTypes.forEach((m) => parts.add(m));
  }
  return Array.from(parts).join(',');
}

/** A readable list of allowed types for hints/errors, e.g. "Images, PDF, Excel". */
export function describeAllowedTypes(accept: readonly FileTypePreset[]): string {
  return accept.map((k) => FILE_TYPE_PRESETS[k].label).join(', ');
}

/** True when a file matches any allowed preset (by extension OR mime). */
function isTypeAllowed(file: File, accept: readonly FileTypePreset[]): boolean {
  const ext = extensionOf(file.name);
  const mime = (file.type || '').toLowerCase();
  return accept.some((key) => {
    const rule = FILE_TYPE_PRESETS[key];
    return rule.extensions.includes(ext) || (mime !== '' && rule.mimeTypes.includes(mime));
  });
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `f${Date.now().toString(36)}${idCounter}`;
}

/**
 * Pure validation: given the currently-selected files, a batch of newly-picked files,
 * and the config, decide which new files are accepted vs rejected (with reasons).
 *
 * Rules, in order, per file:
 *   1. type      — extension/MIME must match an allowed preset
 *   2. size      — must be <= maxSizeBytes
 *   3. duplicate — same name+size already selected
 *   4. maxFiles  — would exceed the total allowed count
 *
 * Kept pure (no DOM, no side effects) so it's trivially testable and reusable.
 */
export function validateFiles(
  existing: readonly SelectedFile[],
  incoming: readonly File[],
  config: FileUploadConfig,
): FileValidationResult {
  const accepted: SelectedFile[] = [];
  const rejected: RejectedFile[] = [];
  let count = existing.length;

  const allowedLabel = describeAllowedTypes(config.accept);
  const seen = new Set(existing.map((f) => `${f.name}::${f.sizeBytes}`));

  for (const file of incoming) {
    if (!isTypeAllowed(file, config.accept)) {
      rejected.push({
        name: file.name,
        reason: 'type',
        message: `"${file.name}" is not an allowed type. Allowed: ${allowedLabel}.`,
      });
      continue;
    }
    if (file.size > config.maxSizeBytes) {
      rejected.push({
        name: file.name,
        reason: 'size',
        message: `"${file.name}" is ${formatFileSize(file.size)}, over the ${formatFileSize(config.maxSizeBytes)} limit.`,
      });
      continue;
    }
    const key = `${file.name}::${file.size}`;
    if (seen.has(key)) {
      rejected.push({
        name: file.name,
        reason: 'duplicate',
        message: `"${file.name}" is already added.`,
      });
      continue;
    }
    if (count >= config.maxFiles) {
      rejected.push({
        name: file.name,
        reason: 'maxFiles',
        message: `You can attach at most ${config.maxFiles} file${config.maxFiles === 1 ? '' : 's'}.`,
      });
      continue;
    }

    seen.add(key);
    count += 1;
    accepted.push({
      id: nextId(),
      file,
      name: file.name,
      sizeBytes: file.size,
      status: 'ready',
    });
  }

  return { accepted, rejected };
}
