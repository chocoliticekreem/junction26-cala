"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function RoleSwitcher() {
  const path = usePathname();
  const isInvestor = path?.startsWith("/investor") || path?.startsWith("/path/investor");
  return (
    <nav className="role-switch" aria-label="Role">
      <Link href="/" className={!isInvestor ? "is-active" : ""} aria-current={!isInvestor ? "page" : undefined} data-testid="nav-founder">
        Founder
      </Link>
      <Link href="/path/investor" className={isInvestor ? "is-active" : ""} aria-current={isInvestor ? "page" : undefined} data-testid="nav-investor">
        Investor
      </Link>
    </nav>
  );
}
