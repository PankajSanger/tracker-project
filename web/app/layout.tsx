import "./globals.css";
import type { ReactNode } from "react";
import AuthGate from "@/components/AuthGate";

export const metadata = { title: "Social Tracker", description: "Instagram and X post analytics" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
