"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function RoleSwitcher() {
  const path = usePathname();
  const isInvestor = path?.startsWith("/investor");
  return (
    <nav className="role-switch" aria-label="Role">
      <Link href="/" className={!isInvestor ? "is-active" : ""} aria-current={!isInvestor ? "page" : undefined}>
        Founder
      </Link>
      <Link href="/investor" className={isInvestor ? "is-active" : ""} aria-current={isInvestor ? "page" : undefined}>
        Investor
      </Link>
    </nav>
  );
}
