import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Brooklyn Youth Soccer Academy, free trial',
  description: 'Book a free trial class by talking to Maya, the academy assistant. Prototype on LiveKit Agents.',
};

// Google Fonts via <link> rather than next/font: next/font fetches at build time and failed on the
// Amplify build image. The design tokens only need Inter and Space Grotesk by family name.
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_HREF} />
      </head>
      <body className="min-h-svh">{children}</body>
    </html>
  );
}
