/**
 * Paragraph shapes that have to lay out inside a phone.
 *
 * `corrupted` is not a hypothetical: it is what the reader put on the family's
 * phones on 2026-09-13 — the same words with the spaces gone. It is here so the
 * width check has something that is KNOWN to fail, because a gate nobody has
 * seen fail is not a gate.
 */
export const CLEAN =
  '"That\'s why I found it," Keen said, with the satisfaction of a boy who had learned that ' +
  "impossibilities were often just invitations to look closer. The original Spanish survey had " +
  "called it *Ensenada de los Naufragios*—Bay of Shipwrecks—a name cartographers had quietly dropped.";

export const CORRUPTED = CLEAN.replace(/\*/g, "").replace(/ /g, "");

/** The canary: something the stylesheet cannot rescue. A check that has never
 *  been seen to fail is not known to work. */
export const TOO_WIDE = "__canary__";

export const FIXTURES = {
  clean: CLEAN,
  // A long unbroken URL-ish token, which is the other way prose widens a page.
  longToken: "The file was at https://example.invalid/a/very/long/path/that/never/breaks/anywhere/at/all/x.json and nobody could open it.",
  twoEntities: "Keen looked at Adele. Adele did not look back at Keen.",
  sceneBreak: "Before.\n***\nAfter.",
  corrupted: CORRUPTED,
  canary: TOO_WIDE,
};
