/* Compare answer content independently of rich-text layout. Keep letters,
 * punctuation and digits exact; ignore only whitespace and editor fill chars. */
(() => {
  "use strict";
  const normalize = value => String(value ?? "").normalize("NFC").replace(/[\u200B\uFEFF]/g, "").replace(/\s+/g, "");
  function verify(expected, { editorText, domText, fieldText, fieldFound = false }) {
    const wanted = normalize(expected), editor = normalize(editorText), dom = normalize(domText), field = normalize(fieldText);
    const diagnostic = { expectedChars: wanted.length, editorChars: editor.length, domChars: dom.length, fieldFound: !!fieldFound, fieldChars: fieldFound ? field.length : null };
    let code = "OK";
    if (!wanted) code = "EMPTY_ANSWER";
    else if (editor !== wanted) code = "EDITOR_CONTENT_MISMATCH";
    else if (dom !== wanted) code = "EDITOR_DOM_MISMATCH";
    else if (fieldFound && field !== wanted) code = "SYNC_FIELD_MISMATCH";
    return { ok: code === "OK", code, diagnostic };
  }
  globalThis.XXTText = Object.freeze({ normalize, verify });
})();
