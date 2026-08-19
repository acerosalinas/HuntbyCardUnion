import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Navbar } from "@/components/Navbar";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentBuyer } from "@/lib/buyerAuth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hunt by Card Union",
  description: "Private card-collecting marketplace with live dibs claiming.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const initialBuyer = isSupabaseConfigured() ? await getCurrentBuyer() : null;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')!=='light')document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}`,
          }}
        />
        <Providers initialBuyer={initialBuyer}>
          <ConnectionBanner />
          <Navbar />
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
