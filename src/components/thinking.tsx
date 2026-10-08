export function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}
