import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import I18nProvider from "@/components/I18nProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The metadata for the application.
 * This includes the title and description for the web page.
 */
export const metadata: Metadata = {
  title: "Ecowitt Weather Dashboard",
  description: "Dashboard for Ecowitt weather data",
};

/**
 * The root layout for the application.
 * It sets up the HTML structure, fonts, and the internationalization provider.
 *
 * @param props - The component props.
 * @param props.children - The child components to be rendered within the layout.
 * @returns The root layout component.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <I18nProvider>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
