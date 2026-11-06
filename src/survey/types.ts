/**
 * The survey format. A survey is one JSON file (published under public/surveys/) and can be
 * round-tripped through an Excel workbook (see xlsx.ts). Everything a respondent sees comes
 * from this file, so next term is an edit, not a rebuild.
 */

export const SURVEY_FORMAT = "tps-survey";
export const SCHEMA_VERSION = 1;

export const QUESTION_TYPES = [
  "info",
  "text",
  "longtext",
  "email",
  "yesno",
  "choice",
  "checkboxes",
  "number",
  "numbers",
  "courses",
  "availability",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** One line per type, shown in the builder and written into the Excel "Help" sheet. */
export const TYPE_HELP: Record<QuestionType, { label: string; help: string }> = {
  info: { label: "Information text", help: "Text only, no answer. Blank lines start paragraphs; [link text](https://…) makes a link." },
  text: { label: "Short text", help: "One line of text." },
  longtext: { label: "Long text", help: "A paragraph box." },
  email: { label: "Email", help: "One email address, checked for shape." },
  yesno: { label: "Yes / No", help: "Two buttons, Yes and No." },
  choice: {
    label: "Choose one",
    help: "One answer from the options. Add [explain] after an option to ask for details when it is picked, e.g. Unsure [explain: Tell us about your situation].",
  },
  checkboxes: { label: "Choose any", help: "Any number of the options. [explain] works here too." },
  number: { label: "Number", help: "Settings: min, max, step, slider (yes/no), unit. The option list, if any, labels the number (first option only)." },
  numbers: {
    label: "Several numbers",
    help: "One number per option (each option is a row label). Settings: min, max, step, total (yes shows the sum), unit.",
  },
  courses: {
    label: "Courses (ranked)",
    help: "Ranked course dropdowns from the survey's course list, with a note per course. Settings: levels (ug, grad or ug,grad), max (how many), notes (yes/no).",
  },
  availability: {
    label: "Days and times",
    help: "A grid of days and time blocks; people mark blocks Available or Preferred. Settings: days (e.g. M,T,W,Th,F,Sa,Su), notes (yes/no). The options are the time blocks, e.g. 08:00-09:15.",
  },
};

export interface Question {
  /** Stable answer key: lowercase letters, digits and underscores. */
  id: string;
  type: QuestionType;
  /** The question (or, for info, the heading; may be blank). */
  text: string;
  /** Smaller explanatory text under the question. Same markup as info. */
  help?: string;
  /** Options, one per entry. Meaning depends on the type (choices, row labels, time blocks). */
  options?: string[];
  required?: boolean;
  /** Condition, e.g. `teach_winter = Yes` or `modality != All in-person and teach_spring = Yes`. */
  show_if?: string;
  /** Type-specific settings, e.g. { min: "0", max: "9", step: "1", slider: "yes" }. */
  settings?: Record<string, string>;
}

export interface Course {
  /** The course code as people know it, e.g. "PSYC 1000". Stored in answers. */
  code: string;
  title: string;
  level: "ug" | "grad";
  /** Heading the course is listed under in the dropdown (optional). */
  group?: string;
}

export interface Survey {
  format: typeof SURVEY_FORMAT;
  schema_version: number;
  /** File name without .json; also the survey's id in responses. */
  id: string;
  title: string;
  /** e.g. 2027-spring. */
  term?: string;
  /** Bump when questions change in a way that matters to the scheduler. */
  version: number;
  /** Shown above the first question. Same markup as info. */
  intro?: string;
  /** Shown after submitting. */
  thanks?: string;
  /** Last day to submit (YYYY-MM-DD, inclusive). Blank = open. */
  closes?: string;
  /** Where answers are posted. Blank = respondents download their answers (pilot mode). */
  submit_url?: string;
  /** Contact shown on the form, e.g. "psychology@brooklyn.cuny.edu". */
  contact?: string;
  questions: Question[];
  courses: Course[];
}

/** What a choice / checkboxes answer looks like when an option asks for an explanation. */
export interface ChoiceAnswer {
  value: string;
  explain?: string;
}

export interface CourseAnswer {
  code: string;
  note?: string;
}

export interface AvailabilityAnswer {
  /** Cells as "<day> <block>", e.g. "M 08:00-09:15". */
  available: string[];
  preferred: string[];
  notes?: string;
}

export type AnswerValue =
  | string
  | number
  | ChoiceAnswer
  | ChoiceAnswer[]
  | Record<string, number>
  | CourseAnswer[]
  | AvailabilityAnswer;

export type Answers = Record<string, AnswerValue | undefined>;

export interface ResponseFile {
  format: "tps-response";
  survey_id: string;
  survey_version: number;
  term?: string;
  /** From the personal link (?t=…), when there is one. */
  token?: string;
  /** Added by the response collector from the personal link's token. */
  person_id?: string;
  submitted_at: string;
  answers: Answers;
}
