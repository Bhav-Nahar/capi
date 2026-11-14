import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = { title: 'Conversions Console', robots: { index: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ToastProvider>
            <Shell>{children}</Shell>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
