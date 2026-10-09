/** The header may choose a logo variant explicitly so it follows the app's saved theme, not only the OS theme. */
export function BrandLogo({ wordmark = true, className = "", inverse = false, variant }: { wordmark?: boolean; className?: string; inverse?: boolean; variant?: "light" | "dark" }) {
  const size = wordmark ? "h-10 w-10" : "h-20 w-20";
  const selectedVariant = variant ?? (inverse ? "dark" : null);
  return (
    <span role="img" aria-label="Peebee" className={"flex shrink-0 items-center gap-2 " + className}>
      {selectedVariant ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/brand/peebee-logo-${selectedVariant}.svg?v=logo-6`} alt="" width={256} height={256} className={size + " shrink-0 object-contain"} />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/peebee-logo-light.svg?v=logo-6" alt="" width={256} height={256} className={size + " shrink-0 object-contain dark:hidden"} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/peebee-logo-dark.svg?v=logo-6" alt="" width={256} height={256} className={"hidden " + size + " shrink-0 object-contain dark:block"} />
        </>
      )}
      {wordmark && <span aria-hidden="true" className={"text-2xl font-black leading-none " + (selectedVariant === "light" ? "text-black" : selectedVariant === "dark" ? "text-white" : "text-[#000] dark:text-[#fff]")}>Peebee</span>}
    </span>
  );
}
