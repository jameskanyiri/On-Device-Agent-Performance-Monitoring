import type { Metadata } from 'next';

import { NavRail } from '@/components/nav-rail';
import { TooltipProvider } from '@/ui/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'On-device Observability',
  description: 'Traces and device metrics for the on-device AI app: benchmarks and everyday chats.',
};

// Sets the theme before paint (a remembered choice, else the system's), so the page doesn't flash.
const themeScript = `try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}`;

/** Shift's shell: a tinted canvas, the icon rail, and the current view on a white rounded panel. */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <TooltipProvider delayDuration={300}>
          <div className="flex h-screen bg-muted/60">
            <NavRail />
            <main className="relative my-2 mr-2 min-w-0 flex-1 overflow-y-auto rounded-2xl bg-background shadow-frame [scrollbar-gutter:stable]">
              {children}
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
