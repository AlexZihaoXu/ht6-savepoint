/**
 * Tiny hard-coded seed data so the placeholder screens feel alive during the
 * scaffold phase. This will be replaced by data from the backend API
 * (people / events / days / recaps) once wiring lands — keep the shapes close
 * to DESIGN.md §9 so the swap is mechanical.
 */

export interface Person {
  id: string;
  name: string;
  /** two-letter fallback shown in the avatar before a sprite is generated */
  initials: string;
  /** background tint for the placeholder sprite chip */
  tint: string;
  lastSeen: string;
  tags: string[];
  favorite: boolean;
  spokeToday: boolean;
  blurb: string;
}

export interface DayTile {
  date: string; // ISO yyyy-mm-dd
  label: string; // day-of-month
  /** garden growth stage 0..3 driving the plant icon */
  stage: 0 | 1 | 2 | 3;
  isToday: boolean;
  people: number;
}

export interface DialogueLine {
  speaker: "you" | "them";
  name: string;
  text: string;
  time: string;
}

export const TODAY_ISO = "2026-07-18";

export const people: Person[] = [
  {
    id: "vee",
    name: "Vee",
    initials: "VE",
    tint: "oklch(80% 0.12 200)",
    lastSeen: "just now",
    tags: ["teammate", "frontend"],
    favorite: true,
    spokeToday: true,
    blurb: "Pair-programmed the garden view. Owes you a coffee.",
  },
  {
    id: "dan",
    name: "Dan",
    initials: "DA",
    tint: "oklch(82% 0.13 60)",
    lastSeen: "2h ago",
    tags: ["teammate", "hardware"],
    favorite: false,
    spokeToday: true,
    blurb: "Flashed the Pi 5. Very excited about the mute switch LED.",
  },
  {
    id: "jc",
    name: "JC",
    initials: "JC",
    tint: "oklch(78% 0.14 300)",
    lastSeen: "yesterday",
    tags: ["teammate", "speech"],
    favorite: true,
    spokeToday: false,
    blurb: "Tuning the diarization pipeline. Says hi via transcript.",
  },
  {
    id: "mentor",
    name: "QNX Mentor",
    initials: "QM",
    tint: "oklch(84% 0.10 140)",
    lastSeen: "3d ago",
    tags: ["mentor"],
    favorite: false,
    spokeToday: false,
    blurb: "Confirmed the on-device inference path counts for the prize.",
  },
];

export const gardenDays: DayTile[] = Array.from({ length: 21 }, (_, i) => {
  const day = i + 1;
  const isToday = day === 18;
  const stage: DayTile["stage"] = isToday
    ? 2
    : day > 18
      ? 0
      : ((day % 3) as 0 | 1 | 2 | 3);
  return {
    date: `2026-07-${String(day).padStart(2, "0")}`,
    label: String(day),
    stage,
    isToday,
    people: day > 18 ? 0 : (day % 4) + (isToday ? 3 : 0),
  };
});

export const sampleDialogue: DialogueLine[] = [
  {
    speaker: "them",
    name: "Vee",
    text: "Okay, the garden tiles animate in now. Watch this.",
    time: "10:24",
  },
  {
    speaker: "you",
    name: "You",
    text: "Whoa. It actually feels like Stardew. The bob is perfect.",
    time: "10:24",
  },
  {
    speaker: "them",
    name: "Vee",
    text: "Right? Every day you log becomes a little plant.",
    time: "10:25",
  },
  {
    speaker: "you",
    name: "You",
    text: "Ship it. Your life autosaves. 🌱",
    time: "10:25",
  },
];

export function findPerson(id: string | undefined): Person | undefined {
  return people.find((p) => p.id === id);
}
