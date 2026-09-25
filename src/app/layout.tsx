import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PixelRevive — Depixelate & Unblur Images",
  description:
    "Browser-based image restoration studio: depixelate mosaic/censored images, remove blur via Richardson-Lucy deconvolution, and sharpen detail — with before/after comparison.",
  keywords: ["depixelate", "unblur", "image restoration", "super resolution", "sharpen", "deblur"],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "PixelRevive — Image Restoration Studio",
    description: "Depixelate, unblur and sharpen images directly in your browser.",
    siteName: "PixelRevive",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
