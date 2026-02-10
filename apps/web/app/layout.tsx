import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Taste Labs Concierge',
  description: 'Milestone 1 demo chat'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

