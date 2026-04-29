export default function RespondLoading() {
  return (
    <div className="flex h-screen overflow-hidden animate-pulse">
      {/* Left panel skeleton */}
      <div className="w-[40%] bg-neutral-950 flex items-center justify-center max-md:hidden">
        <div className="w-28 h-28 rounded-full bg-neutral-800/50" />
      </div>

      {/* Right panel skeleton */}
      <div className="flex-1 bg-background flex flex-col items-start justify-center px-12 py-16 gap-6 max-w-lg mx-auto">
        {/* Badge skeleton */}
        <div className="h-6 w-32 rounded-full bg-muted/40" />

        {/* Title skeleton */}
        <div className="space-y-3 w-full">
          <div className="h-9 w-3/4 rounded bg-muted/30" />
          <div className="h-5 w-1/2 rounded bg-muted/20" />
        </div>

        {/* Quote area skeleton */}
        <div className="space-y-2 w-full">
          <div className="h-4 w-4/5 rounded bg-muted/15" />
          <div className="h-4 w-2/3 rounded bg-muted/15" />
        </div>

        {/* Button skeleton */}
        <div className="h-11 w-36 rounded-md bg-muted/25" />

        {/* Meta skeleton */}
        <div className="h-4 w-24 rounded bg-muted/15" />
      </div>
    </div>
  );
}
