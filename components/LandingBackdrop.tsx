export function LandingBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="bg-dot-grid absolute inset-0 opacity-[0.4] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_35%,black,transparent)]" />
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-gold/20 blur-[100px]" />
      <div className="absolute -right-24 top-40 h-80 w-80 rounded-full bg-gold/15 blur-[100px]" />
      <div className="absolute bottom-0 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-gold/10 blur-[120px]" />
    </div>
  );
}
