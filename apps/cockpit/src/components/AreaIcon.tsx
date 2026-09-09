import { BriefcaseBusiness, GraduationCap, Sparkles } from "lucide-react";
import type { FocusAreaIcon } from "../domain/areas";

const icons = {
  briefcase: BriefcaseBusiness,
  sparkles: Sparkles,
  "graduation-cap": GraduationCap,
};

export function AreaIcon({ icon, size = 20 }: { icon: FocusAreaIcon; size?: number }) {
  const Icon = icons[icon];
  return <Icon size={size} aria-hidden="true" />;
}
