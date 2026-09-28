/* Icon: Feather, MIT, copyright Cole Bemis. See src/assets/feather/LICENSE. */
import star from "../../assets/feather/star.svg";
export default function BrowserUtilityIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <img src={star} alt="" aria-hidden="true" className={`shrink-0 dark:invert ${className}`} />;
}
