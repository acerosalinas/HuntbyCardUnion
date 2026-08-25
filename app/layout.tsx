import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { THEME_STORAGE_KEY } from "@/lib/theme";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Deliberately not resolving the signed-in buyer here anymore: this layout
  // wraps every route, so an `await getCurrentBuyer()` here (a Supabase Auth
  // network round-trip plus a profiles query) used to block EVERY navigation
  // in the app on it - see the Next.js loading.js docs' note that a layout
  // touching runtime/cookie data blocks navigation even past a route's own
  // loading.tsx. BuyerIdentityProvider already reconciles the real identity
  // from the browser's own Supabase client moments after mount regardless
  // (see its own comments - it treats the server value as "a starting
  // point, not the last word" already), so skipping the server round-trip
  // here only costs a brief, already-tolerated flash of signed-out chrome,
  // never a wrong authorization decision - actual buyer-gated pages
  // (/account, RPC calls) resolve/verify identity independently.
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
        <Providers initialBuyer={null}>
          <ConnectionBanner />
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
