import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  availabilityBlocks,
  availabilityDays,
  blockLabel,
  cellKey,
  DAY_NAMES,
  flag,
  numberSpec,
  parseOption,
  setting,
} from "../survey/logic";
import type { AnswerValue, AvailabilityAnswer, ChoiceAnswer, CourseAnswer, Question, Survey } from "../survey/types";
import { Markup } from "../shared/Markup";

interface InputProps<T> {
  q: Question;
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  labelId: string;
  survey: Survey;
}

/** One question: its text, help, input and problem message. */
export function QuestionView({
  q,
  survey,
  value,
  onChange,
  problem,
  number,
}: {
  q: Question;
  survey: Survey;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue | undefined) => void;
  problem?: string | null;
  number?: number;
}) {
  const labelId = useId();
  if (q.type === "info") {
    return (
      <section className="question info" id={`q-${q.id}`}>
        {q.text && <h2 className="info-title">{q.text}</h2>}
        <Markup text={q.help} />
      </section>
    );
  }
  const props = { q, survey, value: value as never, onChange: onChange as never, labelId };
  return (
    <section className={`question${problem ? " has-problem" : ""}`} id={`q-${q.id}`} role="group" aria-labelledby={labelId}>
      <h2 className="q-text" id={labelId}>
        {number !== undefined && <span className="q-num">{number}.</span>}
        {q.text}
        {q.required ? <span className="req" aria-label="required"> *</span> : <span className="optional"> (optional)</span>}
      </h2>
      <Markup text={q.help} className="q-help" />
      <div className="q-input">
        {q.type === "text" && <TextInput {...props} />}
        {q.type === "email" && <TextInput {...props} email />}
        {q.type === "longtext" && <LongText {...props} />}
        {q.type === "yesno" && <YesNo {...props} />}
        {q.type === "choice" && <Choice {...props} />}
        {q.type === "checkboxes" && <Checkboxes {...props} />}
        {q.type === "number" && <NumberInput {...props} />}
        {q.type === "numbers" && <Numbers {...props} />}
        {q.type === "courses" && <Courses {...props} />}
        {q.type === "availability" && <Availability {...props} />}
      </div>
      {problem && (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

function TextInput({ value, onChange, labelId, email }: InputProps<string> & { email?: boolean }) {
  return (
    <input
      className="text"
      type={email ? "email" : "text"}
      autoComplete={email ? "email" : undefined}
      aria-labelledby={labelId}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function LongText({ value, onChange, labelId }: InputProps<string>) {
  return <textarea rows={4} aria-labelledby={labelId} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

function YesNo({ value, onChange, q }: InputProps<string>) {
  const name = useId();
  return (
    <div className="segmented" role="radiogroup">
      {["Yes", "No"].map((opt) => (
        <label key={opt} className={value === opt ? "on" : ""}>
          <input type="radio" name={name} checked={value === opt} onChange={() => onChange(opt)} data-q={q.id} />
          {opt}
        </label>
      ))}
    </div>
  );
}

function Choice({ q, value, onChange }: InputProps<ChoiceAnswer>) {
  const name = useId();
  const opts = (q.options ?? []).map(parseOption);
  return (
    <div className="options" role="radiogroup">
      {opts.map((o) => {
        const on = value?.value === o.label;
        return (
          <div key={o.label} className={`option${on ? " on" : ""}`}>
            <label>
              <input type="radio" name={name} checked={on} onChange={() => onChange({ value: o.label, ...(o.explain ? { explain: "" } : {}) })} />
              <span>{o.label}</span>
            </label>
            {on && o.explain && (
              <input
                className="text explain"
                placeholder={o.explain}
                aria-label={o.explain}
                value={value?.explain ?? ""}
                onChange={(e) => onChange({ value: o.label, explain: e.target.value })}
                autoFocus
              />
            )}
          </div>
        );
      })}
      {value && !q.required && (
        <button type="button" className="link" onClick={() => onChange(undefined)}>
          Clear my answer
        </button>
      )}
    </div>
  );
}

function Checkboxes({ q, value, onChange }: InputProps<ChoiceAnswer[]>) {
  const opts = (q.options ?? []).map(parseOption);
  const list = value ?? [];
  const toggle = (label: string, on: boolean) => {
    const next = on ? [...list, { value: label }] : list.filter((a) => a.value !== label);
    // Keep the options' order.
    next.sort((a, b) => opts.findIndex((o) => o.label === a.value) - opts.findIndex((o) => o.label === b.value));
    onChange(next.length ? next : undefined);
  };
  return (
    <div className="options">
      {opts.map((o) => {
        const a = list.find((x) => x.value === o.label);
        return (
          <div key={o.label} className={`option${a ? " on" : ""}`}>
            <label>
              <input type="checkbox" checked={!!a} onChange={(e) => toggle(o.label, e.target.checked)} />
              <span>{o.label}</span>
            </label>
            {a && o.explain && (
              <input
                className="text explain"
                placeholder={o.explain}
                aria-label={o.explain}
                value={a.explain ?? ""}
                onChange={(e) => onChange(list.map((x) => (x.value === o.label ? { ...x, explain: e.target.value } : x)))}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** A number box with − / + buttons; blank means unanswered. */
function Stepper({
  value,
  onChange,
  spec,
  label,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  spec: ReturnType<typeof numberSpec>;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const bump = (d: number) => onChange(clamp(roundTo((value ?? spec.min) + d, spec.step), spec.min, spec.max));
  return (
    <span className="stepper">
      <button type="button" aria-label={`Less ${label}`} onClick={() => bump(-spec.step)} disabled={value !== undefined && value <= spec.min}>
        −
      </button>
      <input
        inputMode="decimal"
        aria-label={label}
        value={draft ?? (value === undefined ? "" : fmt(value))}
        onChange={(e) => {
          setDraft(e.target.value);
          const t = e.target.value.trim();
          if (t === "") onChange(undefined);
          else if (Number.isFinite(Number(t))) onChange(Number(t));
        }}
        onBlur={() => setDraft(null)}
      />
      <button type="button" aria-label={`More ${label}`} onClick={() => bump(spec.step)} disabled={value !== undefined && value >= spec.max}>
        +
      </button>
      {spec.unit && <span className="unit">{spec.unit}</span>}
    </span>
  );
}

function NumberInput({ q, value, onChange }: InputProps<number>) {
  const spec = numberSpec(q);
  const label = q.options?.[0] ?? q.text;
  const slider = flag(q, "slider");
  const ticks = (spec.max - spec.min) / spec.step <= 20;
  return (
    <div className="number">
      {q.options?.[0] && <div className="row-label">{q.options[0]}</div>}
      {slider && (
        <div className={`slider${value === undefined ? " untouched" : ""}`}>
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={value ?? spec.min}
            aria-label={label}
            onChange={(e) => onChange(Number(e.target.value))}
            onClick={(e) => value === undefined && onChange(Number((e.target as HTMLInputElement).value))}
          />
          {ticks && (
            <div className="ticks" aria-hidden>
              {Array.from({ length: Math.round((spec.max - spec.min) / spec.step) + 1 }, (_, i) => (
                <span key={i}>{fmt(spec.min + i * spec.step)}</span>
              ))}
            </div>
          )}
        </div>
      )}
      <Stepper value={value} onChange={onChange} spec={spec} label={label} />
      {slider && <div className="muted small slider-state">{value === undefined ? "Not answered yet: drag the slider or use − / +." : "\u00a0"}</div>}
    </div>
  );
}

function Numbers({ q, value, onChange }: InputProps<Record<string, number>>) {
  const spec = numberSpec(q);
  const rows = (q.options ?? []).map((o) => parseOption(o).label);
  const rec = value ?? {};
  const set = (k: string, n: number | undefined) => {
    const next = { ...rec };
    if (n === undefined) delete next[k];
    else next[k] = n;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const total = Object.values(rec).reduce((a, b) => a + b, 0);
  return (
    <table className="numbers">
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <th scope="row">{r}</th>
            <td>
              <Stepper value={rec[r]} onChange={(n) => set(r, n)} spec={spec} label={r} />
            </td>
          </tr>
        ))}
        {flag(q, "total") && (
          <tr className="total">
            <th scope="row">Total</th>
            <td>
              {fmt(total)} {spec.unit ?? ""}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Courses({ q, survey, value, onChange }: InputProps<CourseAnswer[]>) {
  const levels = (setting(q, "levels") ?? "ug,grad").split(/[,\s]+/);
  const max = Math.max(1, Number(setting(q, "max") ?? 7) || 7);
  const notes = flag(q, "notes", true);
  const list = value && value.length ? value : [{ code: "" }];
  const courses = survey.courses.filter((c) => levels.includes(c.level));

  // Dropdown headings: level, then the course's group.
  const groups = new Map<string, typeof courses>();
  for (const c of courses) {
    const lvl = c.level === "ug" ? "Undergraduate" : "Graduate";
    const key = c.group ? `${lvl} · ${c.group}` : lvl;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const update = (next: CourseAnswer[]) => onChange(next.some((c) => c.code || c.note) ? next : undefined);
  const move = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    update(next);
  };
  const chosen = new Set(list.map((c) => c.code));
  return (
    <div className="courses">
      <ol>
        {list.map((c, i) => (
          <li key={i} className="course-row">
            <span className="rank">{i === 0 ? "Most preferred" : `Choice ${i + 1}`}</span>
            <select
              aria-label={`Course choice ${i + 1}`}
              value={c.code}
              onChange={(e) => update(list.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}
            >
              <option value="">Choose a course…</option>
              {[...groups].map(([g, cs]) => (
                <optgroup key={g} label={g}>
                  {cs.map((x) => (
                    <option key={x.code} value={x.code} disabled={chosen.has(x.code) && x.code !== c.code}>
                      {x.code} — {x.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {notes && (
              <input
                className="text note"
                placeholder="Notes (optional), e.g. jumbo section, 2 sections"
                aria-label={`Notes for choice ${i + 1}`}
                value={c.note ?? ""}
                onChange={(e) => update(list.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
              />
            )}
            <span className="row-tools">
              <button type="button" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" aria-label="Move down" title="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                type="button"
                aria-label="Remove"
                title="Remove"
                onClick={() => update(list.length === 1 ? [{ code: "" }] : list.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>
      {list.length < max && (
        <button type="button" className="secondary" onClick={() => update([...list, { code: "" }])}>
          + Add another class
        </button>
      )}
      <p className="muted small">Don't see a course? Mention it in the notes or in the last question.</p>
    </div>
  );
}

type Mode = "available" | "preferred";

function Availability({ q, value, onChange }: InputProps<AvailabilityAnswer>) {
  const days = availabilityDays(q);
  const blocks = availabilityBlocks(q);
  const [mode, setMode] = useState<Mode>("available");
  const a: AvailabilityAnswer = value ?? { available: [], preferred: [] };
  /** The cell a mouse press just handled, so the click that follows it is not counted twice. */
  const handled = useRef<{ k: string; at: number } | null>(null);
  /** A mouse drag paints the rectangle from the cell it started on to the cell under the pointer. */
  const drag = useRef<{ action: Mode | "clear"; start: string; last: string; base: AvailabilityAnswer } | null>(null);

  const stateOf = (k: string, src = a): Mode | "" => (src.preferred.includes(k) ? "preferred" : src.available.includes(k) ? "available" : "");

  const apply = (keys: string[], action: Mode | "clear", src: AvailabilityAnswer): AvailabilityAnswer => {
    const avail = new Set(src.available);
    const pref = new Set(src.preferred);
    for (const k of keys) {
      avail.delete(k);
      pref.delete(k);
      if (action === "available") avail.add(k);
      if (action === "preferred") pref.add(k);
    }
    const order = (s: Set<string>) => days.flatMap((d) => blocks.map((b) => cellKey(d, b))).filter((k) => s.has(k));
    return { available: order(avail), preferred: order(pref), ...(src.notes ? { notes: src.notes } : {}) };
  };

  const commit = (next: AvailabilityAnswer) =>
    onChange(next.available.length || next.preferred.length || next.notes ? next : undefined);

  /** Clicking a cell already in the current mode clears it; otherwise it takes the mode. */
  const actionFor = (keys: string[]): Mode | "clear" => (keys.every((k) => stateOf(k) === mode) ? "clear" : mode);

  const toggleKeys = (keys: string[]) => commit(apply(keys, actionFor(keys), a));

  const onPointerDown = (e: ReactPointerEvent, k: string) => {
    if (e.pointerType === "touch") return; // touch: plain taps (onClick), so the page still scrolls
    e.preventDefault();
    handled.current = { k, at: Date.now() };
    const action = actionFor([k]);
    drag.current = { action, start: k, last: k, base: a };
    commit(apply([k], action, a));
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const k = el?.closest<HTMLElement>("[data-cell]")?.dataset.cell;
    if (!k || k === d.last) return;
    d.last = k;
    commit(apply(rectangle(d.start, k), d.action, d.base));
  };
  const rectangle = (from: string, to: string): string[] => {
    const pos = (k: string) => {
      const sp = k.indexOf(" ");
      return [days.indexOf(k.slice(0, sp)), blocks.indexOf(k.slice(sp + 1))];
    };
    const [d1, b1] = pos(from);
    const [d2, b2] = pos(to);
    const keys: string[] = [];
    for (let d = Math.min(d1, d2); d <= Math.max(d1, d2); d++)
      for (let b = Math.min(b1, b2); b <= Math.max(b1, b2); b++) keys.push(cellKey(days[d], blocks[b]));
    return keys;
  };
  const endDrag = () => {
    drag.current = null;
  };

  const counts = { available: a.available.length, preferred: a.preferred.length };
  return (
    <div className="availability" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
      <div className="avail-tools">
        <span className="muted small">Marking:</span>
        <div className="segmented small" role="radiogroup" aria-label="What a click marks">
          <label className={mode === "available" ? "on" : ""}>
            <input type="radio" checked={mode === "available"} onChange={() => setMode("available")} />
            <span className="swatch available" /> Available
          </label>
          <label className={mode === "preferred" ? "on" : ""}>
            <input type="radio" checked={mode === "preferred"} onChange={() => setMode("preferred")} />
            <span className="swatch preferred" /> Preferred
          </label>
        </div>
        {(counts.available > 0 || counts.preferred > 0) && (
          <button type="button" className="link" onClick={() => commit({ available: [], preferred: [], notes: a.notes })}>
            Clear all
          </button>
        )}
      </div>
      <div className="grid-wrap">
        <table className="avail-grid">
          <thead>
            <tr>
              <th />
              {days.map((d) => (
                <th key={d} scope="col">
                  <button
                    type="button"
                    className="head"
                    title={`Mark all of ${DAY_NAMES[d] ?? d}`}
                    onClick={() => toggleKeys(blocks.map((b) => cellKey(d, b)))}
                  >
                    <span className="day-short">{d}</span>
                    <span className="day-long">{DAY_NAMES[d] ?? d}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b}>
                <th scope="row">
                  <button type="button" className="head" title={`Mark ${blockLabel(b)} on every day`} onClick={() => toggleKeys(days.map((d) => cellKey(d, b)))}>
                    {blockLabel(b)}
                  </button>
                </th>
                {days.map((d) => {
                  const k = cellKey(d, b);
                  const st = stateOf(k);
                  return (
                    <td key={k}>
                      <button
                        type="button"
                        data-cell={k}
                        className={`cell ${st}`}
                        aria-label={`${DAY_NAMES[d] ?? d} ${blockLabel(b)}: ${st || "not available"}`}
                        aria-pressed={st !== ""}
                        onPointerDown={(e) => onPointerDown(e, k)}
                        onClick={() => {
                          // Mouse presses were handled on pointer down; taps and the keyboard land here.
                          const h = handled.current;
                          handled.current = null;
                          if (h && h.k === k && Date.now() - h.at < 1500) return;
                          toggleKeys([k]);
                        }}
                      >
                        {st === "preferred" ? "★" : st === "available" ? "✓" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" aria-live="polite">
        {counts.available + counts.preferred === 0
          ? "Nothing marked yet. Click a day or a time to mark a whole column or row."
          : `${counts.available + counts.preferred} blocks marked${counts.preferred ? `, ${counts.preferred} preferred` : ""}.`}
      </p>
      {flag(q, "notes", true) && (
        <textarea
          rows={2}
          className="avail-notes"
          placeholder="Anything else about your availability? (optional)"
          aria-label="Notes about your availability"
          value={a.notes ?? ""}
          onChange={(e) => commit({ ...a, notes: e.target.value || undefined })}
        />
      )}
    </div>
  );
}
