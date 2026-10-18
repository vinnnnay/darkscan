import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "../components/Chrome.tsx";
import { StoreProvider } from "../lib/store.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "DarkBench Store",
  description: "A test shop with switchable, deliberately planted dark patterns for evaluating DarkScan.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <Shell>{children}</Shell>
        </StoreProvider>
      </body>
    </html>
  );
}
