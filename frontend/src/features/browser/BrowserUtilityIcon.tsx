/* Icons: Feather, MIT, copyright Cole Bemis. See src/assets/feather/LICENSE. */
import star from "../../assets/feather/star.svg";
import help from "../../assets/feather/help-circle.svg";
import bookmark from "../../assets/feather/bookmark.svg";
export default function BrowserUtilityIcon({ name, className = "h-4 w-4" }: { name: "star" | "help" | "bookmark"; className?: string }) {
  return <img src={{ star, help, bookmark }[name]} alt="" aria-hidden="true" className={`shrink-0 dark:invert ${className}`} />;
}
