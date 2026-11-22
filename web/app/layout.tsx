import "./globals.css";
import type { ReactNode } from "react";
import Shell from "@/components/Shell";

export const metadata = { title: "Social Tracker", description: "Instagram, YouTube and X analytics for your team" };

// Apply the saved theme before first paint to avoid a light/dark flash.
const themeScript = `try{var t=localStorage.getItem("st-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
