import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SUBURBAN',
  description: 'Planejamento urbano e tecnologia por uma cidade mais segura.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
