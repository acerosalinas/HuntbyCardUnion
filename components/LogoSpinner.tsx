import { cn } from "@/lib/utils";

/** The Card Union mark, spinning - the branded stand-in for a generic loading spinner. */
export function LogoSpinner({ size = 40, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small local brand asset, not worth next/image's overhead for a spinner
    <img
      src="/crdunion.png"
      alt="Loading"
      width={size}
      height={size}
      className={cn("animate-spin", className)}
      style={{ animationDuration: "1.4s" }}
    />
  );
}
