import Image from "next/image";

/** Decorative Overtime mark next to text that already describes the content. */
export function LogoMark({ size = 20 }: { size?: number }) {
  return <Image src="/images/logo.png" alt="" aria-hidden="true" width={size} height={size} className="tr-inline-logo" />;
}
