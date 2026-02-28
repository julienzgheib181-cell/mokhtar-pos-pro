import "./../styles/globals.css";
import Link from "next/link";

export const metadata = {
  title: "Mokhtar Cell POS Pro",
  description: "Sales + Dashboard",
};

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="pill" href={href}>
      {label}
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="topbar">
          <div className="container" style={{display:"flex", alignItems:"center", gap:14}}>
            <div className="brand">
              <div className="logo" aria-hidden="true" />
              <div>
                <div style={{fontSize:14}}>Mokhtar Cell</div>
                <div className="muted" style={{fontSize:12, marginTop:2}}>POS Pro • Blue</div>
              </div>
            </div>
            <div className="nav">
              <NavLink href="/sales" label="Sales (POS)" />
              <NavLink href="/dashboard" label="Dashboard" />
              <NavLink href="/reports" label="Reports" />
              <NavLink href="/debts" label="Debts" />
              <NavLink href="/reminders" label="Reminders" />
              <NavLink href="/settings" label="Settings" />
            </div>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
