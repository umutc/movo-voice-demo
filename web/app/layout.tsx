import type { Metadata } from 'next';
import { AcademyProvider } from '@/components/app/academy';
import { academyName, personaName } from '@/lib/site';
import '@/styles/globals.css';

export function generateMetadata(): Metadata {
  return {
    title: `${academyName()}, free trial`,
    description: `Book a free trial class by talking to ${personaName()}, the academy assistant. Prototype on LiveKit Agents.`,
  };
}

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
      <body className="min-h-svh">
        <AcademyProvider name={academyName()}>{children}</AcademyProvider>
      </body>
    </html>
  );
}
