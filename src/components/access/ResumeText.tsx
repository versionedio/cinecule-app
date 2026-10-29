import { useMemo } from "react";

type Block = { kind: "heading" | "paragraph" | "bullets"; lines: string[] };

const SECTIONS =
  /^(summary|profile|about( me)?|objective|experience|work experience|professional experience|education|skills|technical skills|projects|certifications?|awards?|honors|activities|leadership|volunteering|publications|languages|interests|contact)$/i;
const BULLET = /^[•●▪◦·‣*-]\s+/;

const isHeading = (line: string) => line.length <= 32 && !/[.,;:]$/.test(line) && (SECTIONS.test(line) || (line === line.toUpperCase() && /[A-Z]/.test(line)));

/**
 * Text pulled out of a PDF has a line break wherever the page wrapped. This puts the sentences back together, sets
 * section titles (Experience, Education ...) apart and turns bullet lines into a list, so it reads like the document.
 */
export function formatResume(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const last = () => blocks[blocks.length - 1];
  for (const line of lines) {
    if (!line) {
      blocks.push({ kind: "paragraph", lines: [] }); // a blank line ends the paragraph
      continue;
    }
    if (isHeading(line)) {
      blocks.push({ kind: "heading", lines: [line] });
      continue;
    }
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, "");
      if (last()?.kind === "bullets") last().lines.push(item);
      else blocks.push({ kind: "bullets", lines: [item] });
      continue;
    }
    const prev = last();
    if (prev?.kind === "bullets" && /^[a-z]/.test(line)) {
      prev.lines[prev.lines.length - 1] += ` ${line}`; // a wrapped bullet
      continue;
    }
    if (prev?.kind === "paragraph" && prev.lines.length > 0) {
      const before = prev.lines[prev.lines.length - 1];
      // The page wrapped mid-sentence: the line before was full-width and did not end a sentence, or this one carries on in lower case.
      if (/^[a-z(]/.test(line) || (before.length >= 70 && !/[.!?:;]$/.test(before))) {
        prev.lines[prev.lines.length - 1] = `${before} ${line}`;
        continue;
      }
    }
    if (prev?.kind === "paragraph") prev.lines.push(line);
    else blocks.push({ kind: "paragraph", lines: [line] });
  }
  return blocks.filter((b) => b.lines.length > 0);
}

/** An extracted resume, set out as a document. */
export function ResumeText({ text, name }: { text: string; name?: string }) {
  const blocks = useMemo(() => formatResume(text), [text]);
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface-raised">
      {name && <div className="border-b border-border px-5 py-2.5 text-xs uppercase tracking-wider text-muted">{name}</div>}
      <div className="max-h-96 space-y-3 overflow-auto px-5 py-4 text-sm leading-relaxed">
        {blocks.map((b, i) =>
          b.kind === "heading" ? (
            <h3 key={i} className="border-b border-border pb-1 pt-3 font-display text-xs font-semibold uppercase tracking-[0.14em] text-primary-text first:pt-0">
              {b.lines[0]}
            </h3>
          ) : b.kind === "bullets" ? (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted">
              {b.lines.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ul>
          ) : (
            <div key={i} className="space-y-0.5">
              {b.lines.map((l, j) => (
                <p key={j} className={b.lines.length > 1 && j === 0 ? "font-medium text-foreground" : "text-foreground/90"}>
                  {l}
                </p>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
