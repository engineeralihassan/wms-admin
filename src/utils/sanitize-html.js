/**
 * Minimal, dependency-free HTML sanitizer for user-authored rich text (the job
 * description). Defense-in-depth: the description is written by an authenticated
 * recruiter but rendered on the PUBLIC, unauthenticated careers page, so we strip
 * anything executable before it is ever stored.
 *
 * Strategy — allow-list, not block-list:
 *   1. Remove entire dangerous elements and their content (script/style/iframe/…).
 *   2. Drop any tag not on the allow-list (keeping its inner text).
 *   3. On allowed tags, keep only allow-listed attributes, and reject any attribute
 *      value that carries a javascript:/data:/vbscript: URL or inline event handler.
 *
 * This is intentionally conservative. It is NOT a full HTML parser; combined with the
 * frontend's own sanitization (Angular strips unsafe markup on [innerHTML]), it gives
 * two independent layers. For very high-assurance needs, swap in a vetted library
 * (sanitize-html / DOMPurify) behind this same function signature.
 */

// Tags a rich-text description may legitimately contain.
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'a',
  'span',
  'div',
  'code',
  'pre',
]);

// Attributes allowed, per tag. Everything else is dropped.
const ALLOWED_ATTRS = {
  a: new Set(['href', 'title', 'target', 'rel']),
};

// Elements whose CONTENT must be discarded entirely (not just the tag).
const STRIP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math)[\s\S]*?<\/\1>/gi;
// Self-closing / unclosed variants of the same dangerous elements.
const STRIP_VOID_DANGEROUS = /<(script|style|iframe|object|embed|noscript|template|svg|math)[^>]*\/?>/gi;
// HTML comments (can hide conditional comments / payloads).
const STRIP_COMMENTS = /<!--[\s\S]*?-->/g;

const DANGEROUS_URL = /^\s*(javascript:|data:|vbscript:)/i;

/** Decode the few entities we care about when inspecting a URL value. */
const decodeForUrlCheck = (value) =>
  String(value)
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, '&');

/** Escape a bare attribute value for safe re-emission inside double quotes. */
const escapeAttr = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Rebuild the attribute list of a single opening tag, keeping only allow-listed,
 * safe attributes. Returns the sanitized attribute string (leading space included) or ''.
 */
const sanitizeAttributes = (tagName, rawAttrs) => {
  const allowed = ALLOWED_ATTRS[tagName];
  if (!allowed || !rawAttrs) return '';

  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let out = '';
  let match;
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';

    // Never allow inline event handlers or style (style can smuggle expressions).
    if (name.startsWith('on') || name === 'style') continue;
    if (!allowed.has(name)) continue;

    // For URL-bearing attributes, reject dangerous schemes.
    if (name === 'href' && DANGEROUS_URL.test(decodeForUrlCheck(value))) continue;

    out += ` ${name}="${escapeAttr(value)}"`;
  }

  // Links open in a new tab safely: force rel when target=_blank is present.
  if (tagName === 'a' && /target\s*=/.test(out) === false && /href=/.test(out)) {
    // leave as-is; no forced target
  }
  if (tagName === 'a' && /target="_blank"/i.test(out) && !/rel=/i.test(out)) {
    out += ' rel="noopener noreferrer"';
  }
  return out;
};

/**
 * Sanitize an HTML string to a safe subset.
 * @param {string} html
 * @returns {string} sanitized HTML (empty string for falsy input)
 */
const sanitizeHtml = (html) => {
  if (!html || typeof html !== 'string') return '';

  let clean = html
    .replace(STRIP_WITH_CONTENT, '')
    .replace(STRIP_VOID_DANGEROUS, '')
    .replace(STRIP_COMMENTS, '');

  // Walk every tag; keep allow-listed ones (with cleaned attrs), drop the rest
  // (their text content is preserved because we only remove the tag markup).
  clean = clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^">]|"[^"]*")*)>/g, (full, tagName, attrs) => {
    const name = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    const isClosing = /^<\//.test(full);
    if (isClosing) return `</${name}>`;
    const isSelfClosing = /\/\s*>$/.test(full);
    const safeAttrs = sanitizeAttributes(name, attrs);
    return isSelfClosing ? `<${name}${safeAttrs} />` : `<${name}${safeAttrs}>`;
  });

  return clean.trim();
};

/** True when the sanitized HTML has no visible text (only tags/whitespace). */
const isEffectivelyEmpty = (html) => {
  if (!html) return true;
  const text = String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '')
    .trim();
  return text.length === 0;
};

module.exports = { sanitizeHtml, isEffectivelyEmpty };
