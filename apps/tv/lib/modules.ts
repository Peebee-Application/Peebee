import { BookOpen, LayoutGrid, Radio, type LucideIcon } from "lucide-react";

/**
 * What the TV's home screen can open. Adding one is a line here and a route under /app.
 * Only things that exist are listed: nothing on the home screen is a placeholder.
 * `needs` ties a tile to an admin switch the API reports for this TV, so a switched-off feature disappears instead of failing.
 */
export type TvModule = { id: string; title: string; description: string; href: string; icon: LucideIcon; needs: "learn" | "live" };

export const MODULES: TvModule[] = [
  {
    id: "my-courses",
    title: "My courses",
    description: "Your lessons, videos and quizzes",
    href: "/courses",
    icon: BookOpen,
    needs: "learn",
  },
  {
    id: "browse",
    title: "Browse courses",
    description: "Find something new to learn",
    href: "/browse",
    icon: LayoutGrid,
    needs: "learn",
  },
  {
    id: "live",
    title: "Live class",
    description: "Your tutor's class, on this screen",
    href: "/learn",
    icon: Radio,
    needs: "live",
  },
];
