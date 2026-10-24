'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import styles from './OrdersHud.module.css';

type ToastMessage = { text: string; tone: 'good' | 'bad' | 'info' };

function AnimatedToast({ message }: { message: ToastMessage }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const onComplete = () => setVisible(false);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set(node, { opacity: 1, y: 0, scale: 1 });
      const fade = gsap.to(node, { opacity: 0, delay: 1.6, duration: 0.2, onComplete });
      return () => { fade.kill(); };
    }
    const timeline = gsap.timeline();
    timeline
      .fromTo(node, { y: 14, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.28, ease: 'back.out(2)' })
      .to(node, { opacity: 0, y: -8, duration: 0.35, delay: 1.3, onComplete });
    return () => { timeline.kill(); };
  }, []);

  if (!visible) return null;
  return <div ref={root} className={styles.toast} data-tone={message.tone} role="status" aria-live="polite">
    {message.text}
  </div>;
}

/** Each notice owns its DOM and animation. Clearing feedback removes both immediately. */
export default function FeedbackToast({ sequence, message }: { sequence?: number; message: ToastMessage | null }) {
  if (!message?.text.trim()) return null;
  return <AnimatedToast key={sequence} message={message} />;
}
