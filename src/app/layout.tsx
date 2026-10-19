import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Projeto Zero · Game starter',
  description: 'Base de jogo de navegador com Next.js, Three.js e GSAP.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
