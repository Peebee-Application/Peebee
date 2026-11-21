import type { HomeHistoryEntry, HomePersonalizationSettings, HomeShortcut, LearnEnrollment } from "@peebee/shared";

export type HomeInterest = "ride" | "buy" | "eat" | "work" | "learn";
export type HomePreferences = { enabled: boolean; interests: HomeInterest[]; hidden: string[] };
export const EMPTY_HOME_PREFERENCES: HomePreferences = { enabled: true, interests: [], hidden: [] };
export const HOME_INTERESTS: HomeInterest[] = ["ride", "buy", "eat", "work", "learn"];
export type HomeSuggestion = { id: string; interest: HomeInterest; title: string; detail: string; reason: string; action: string; href: string; image: string };

export function homePeriod(date: Date, r: HomePersonalizationSettings): "morning" | "afternoon" | "evening" | "night" {
  const h = date.getHours();
  return h < r.morningHour || h >= r.nightHour ? "night" : h < r.afternoonHour ? "morning" : h < r.eveningHour ? "afternoon" : "evening";
}
export function homeGreeting(date: Date, r: HomePersonalizationSettings): string {
  const period = homePeriod(date, r);
  return period === "night" ? "Still up" : `Good ${period}`;
}
export function homeClock(date: Date): { time: string; date: string } {
  const n = date.getDate();
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return {
    time: `${date.toLocaleDateString("en-GB", { weekday: "long" })}, ${date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, "").toLowerCase()}`,
    date: `${date.toLocaleDateString("en-GB", { month: "long" })} ${n}${suffix}`,
  };
}
function historyDate(value: string): Date { return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`); }
export function parseHomePreferences(raw: string | null): HomePreferences {
  try {
    const v = JSON.parse(raw ?? "null");
    if (!v || typeof v !== "object") return { ...EMPTY_HOME_PREFERENCES };
    return { enabled: v.enabled !== false, interests: Array.isArray(v.interests) ? v.interests.filter((s: unknown): s is HomeInterest => HOME_INTERESTS.includes(s as HomeInterest)) : [], hidden: Array.isArray(v.hidden) ? v.hidden.filter((s: unknown): s is string => typeof s === "string").slice(-100) : [] };
  } catch { return { ...EMPTY_HOME_PREFERENCES }; }
}

/** Only completed history and voluntarily chosen interests; never infer gender, age or religion. */
export function homeSuggestions(input: {
  now: Date; rules: HomePersonalizationSettings; available: HomeShortcut[];
  history: HomeHistoryEntry[]; enrollments: LearnEnrollment[]; preferences: HomePreferences;
}): HomeSuggestion[] {
  const { now, rules: r, available, preferences: p } = input;
  const period = homePeriod(now, r), day = now.getDay(), weekday = day > 0 && day < 6;
  const history = r.historyEnabled && p.enabled ? input.history.filter(h => {
    const age = now.getTime() - historyDate(h.createdAt).getTime();
    return Number.isFinite(age) && age >= 0 && age <= r.historyDays * 86400000;
  }) : [];
  const has = (id: string) => available.find(s => s.id === id);
  const candidates: Array<HomeSuggestion & { routine?: boolean; timely?: boolean; count?: number }> = [];
  const add = (id: string, interest: HomeInterest, title: string, detail: string, reason: string, action: string, image: string, timely = false) => {
    const s = has(id); if (s) candidates.push({ id, interest, title, detail, reason, action, href: s.href, image, timely });
  };
  if (r.rideSuggestions) {
    const commute = weekday && period === "morning" && now.getHours() < r.commuteEndHour;
    add("boda", "ride", commute ? "Heading out this morning?" : "Where to next?", "A ride across town", commute ? "For your weekday morning" : "For your day", "Find a boda", "boda", commute);
    const rides = history.filter(h => {
      const at = historyDate(h.createdAt), d = at.getDay();
      return h.kind === "ride" && h.destination && homePeriod(at, r) === period && (weekday ? d > 0 && d < 6 : d === day);
    });
    const groups = new Map<string, HomeHistoryEntry[]>();
    for (const ride of rides) { const key = ride.destination!.trim().toLowerCase(); groups.set(key, [...(groups.get(key) ?? []), ride]); }
    const usual = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    const boda = has("boda");
    if (boda && usual && usual.length >= r.routineMinTrips) candidates.push({ id: `routine:${usual[0].destination}`, interest: "ride", title: day === 0 ? "Your Sunday ride?" : "Your usual trip?", detail: usual[0].destination!, reason: "From your completed trips at this time", action: "Plan my ride", href: "/ride", image: "boda", routine: true, count: usual.length });
  }
  if (r.foodSuggestions) {
    const lunch = period === "afternoon" && now.getHours() < r.lunchEndHour;
    add("restaurants", "eat", lunch ? "Something for lunch?" : "What sounds delicious?", "Find a meal you’ll love", lunch ? "For your lunch break" : "Explore local food", "See restaurants", "eat-hero", lunch);
    add("streetfood", "eat", "Your evening bite?", "Discover food in your neighbourhood", "For your evening", "Find street food", "street-food", period === "evening");
    const food = history.filter(h => h.kind === "food" && h.restaurantId && h.restaurantName);
    const counts = new Map<string, HomeHistoryEntry[]>();
    for (const entry of food) counts.set(entry.restaurantId!, [...(counts.get(entry.restaurantId!) ?? []), entry]);
    const frequent = [...counts.values()].sort((a, b) => b.length - a.length)[0];
    if (has("restaurants") && frequent && frequent.length >= r.routineMinTrips) candidates.push({ id: `restaurant:${frequent[0].restaurantId}`, interest: "eat", title: "Another favourite meal?", detail: frequent[0].restaurantName!, reason: "A restaurant you’ve ordered from", action: "See menu", href: `/restaurants/${encodeURIComponent(frequent[0].restaurantId!)}`, image: "eat-hero", count: frequent.length, timely: lunch || period === "evening" });
  }
  if (r.weekendHelp) add("clean", "work", "A hand with chores?", "Make room for your weekend", "Cleaning help", "Find help", "clean", day === 6 && period === "morning");
  add("laundry", "work", "Leave the laundry to us", "Find laundry help nearby", "Less to do. More living.", "Find laundry help", "laundry", day === 6 && period === "afternoon");
  add("shopping", "buy", "What’s on your list?", "Get the essentials sorted", "Your everyday shopping", "Create a list", "groceries");
  add("stores", "buy", "Find your next favourite", "Explore local stores", "Something for you", "Browse stores", "stores");
  if (r.learningSuggestions) {
    add("learn", "learn", "A little time to learn?", "Find your next course", "Keep your curiosity growing", "Explore learning", "learn-hero", period === "night");
    const course = r.historyEnabled && p.enabled ? input.enrollments.find(c => c.progressPercent > 0 && c.progressPercent < 100) : null;
    if (course && has("learn")) candidates.push({ id: `course:${course.courseId}`, interest: "learn", title: "Pick up your lesson?", detail: course.title, reason: "Continue where you stopped", action: "Continue learning", href: `/learn/course/${encodeURIComponent(course.courseId)}`, image: "learn-hero", count: 1, timely: period === "night" });
  }
  const interestCounts = (s: HomeSuggestion) => history.filter(h => h.kind === (s.interest === "eat" ? "food" : s.interest === "buy" ? "shopping" : s.interest)).length;
  return candidates.filter(s => !p.hidden.includes(s.id)).sort((a, b) =>
    Number(!!b.routine) - Number(!!a.routine) || Number(p.enabled && p.interests.includes(b.interest)) - Number(p.enabled && p.interests.includes(a.interest))
    || Number(!!b.timely) - Number(!!a.timely) || (b.count ?? 0) - (a.count ?? 0) || interestCounts(b) - interestCounts(a)
  );
}
