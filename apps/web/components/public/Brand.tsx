import Link from "@/components/LoadingLink";
import Image from "next/image";

export function Brand() {
  return (
    <Link href="/" className="brand tr-brand" aria-label="The Ranking หน้าหลัก">
      <Image
        src="/images/logo.png"
        alt="Overtime Logo"
        width={503}
        height={503}
        className="brand-logo"
      />
      <span className="brand-name">
        <strong>THE RANKING</strong>
        <small>BY OVERTIME</small>
      </span>
    </Link>
  );
}
