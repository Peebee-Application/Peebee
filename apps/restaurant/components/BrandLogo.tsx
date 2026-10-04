/** Supplied Peebee symbol; the app's existing theme selector chooses its variant. */
export function BrandLogo({ wordmark = true, className = "" }: { wordmark?: boolean; className?: string }) {
  const size = wordmark ? "h-10 w-10" : "h-20 w-20";
  return (
    <span role="img" aria-label="Peebee" className={"flex shrink-0 items-center gap-2 " + className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/peebee-logo-light.png?v=logos-3" alt="" width={256} height={256} className={size + " shrink-0 object-contain dark:hidden"} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/peebee-logo-dark.png?v=logos-3" alt="" width={256} height={256} className={"hidden " + size + " shrink-0 object-contain dark:block"} />
      {wordmark && <span aria-hidden="true" className="text-2xl font-black leading-none text-ink">Peebee</span>}
    </span>
  );
}
