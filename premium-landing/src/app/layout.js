import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "AntiGravity Bot - AI Crypto Trading Bot",
  description: "AI Trading Bot That Finds Profitable Coins Automatically. Scans all coins, chooses best trade, protects profits, and trades smartly.",
  keywords: "AI crypto bot, automated trading bot, Binance trading bot, USDT bot license, crypto auto trader"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-background text-foreground antialiased`}>
        {children}
      </body>
    </html>
  );
}
