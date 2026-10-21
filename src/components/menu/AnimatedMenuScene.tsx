'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

const artwork = '/assets/ui/b78fccb9-d1fd-4031-a0ea-632d2a8dba2e.png';
const destinations = ['001 · CENTRO', 'SUBURBAN', 'BEM-VINDOS!'];

export default function AnimatedMenuScene({ animated }: { animated: boolean }) {
  const scene = useRef<SVGSVGElement>(null);
  const [destination, setDestination] = useState(0);

  useEffect(() => {
    if (!animated) return;
    const timer = window.setInterval(() => setDestination(value => (value + 1) % destinations.length), 3500);
    const context = gsap.context(() => {
      gsap.timeline({ repeat: -1, repeatDelay: 1.7 })
        .to('.street-light', { opacity: 0, duration: 0.18, ease: 'power1.in' }, 2.1)
        .to('.street-light', { opacity: 1, duration: 0.2, ease: 'power1.out' }, 2.83);
      gsap.to('.shelter-light', { opacity: 0.15, duration: 0.3, repeat: -1, repeatDelay: 3.2, yoyo: true });
      gsap.to('.bus-headlight', { opacity: 0.45, duration: 2.2, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.to('.wifi-wave', { opacity: 0.15, duration: 1.2, stagger: 0.3, repeat: -1, yoyo: true });
      gsap.to('.hair-curly', { x: 1.5, y: -1, rotation: 0.3, svgOrigin: '760 650', duration: 2.4, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.to('.hair-long', { x: 2.5, rotation: -0.6, svgOrigin: '1060 677', duration: 3, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.to('.hair-blue', { x: -2, rotation: 0.6, svgOrigin: '1395 555', duration: 2.7, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.utils.toArray<SVGGElement>('.wind-leaf').forEach((leaf, index) => {
        gsap.fromTo(leaf, { x: -100, y: 40 + (index * 73) % 430, opacity: 0, rotation: -35 }, {
          x: 1800, y: 350 + (index * 97) % 650, rotation: 220 + index * 47,
          opacity: 0.85, duration: 13 + index % 5, delay: -index * 2.3, repeat: -1, ease: 'none',
        });
      });
    }, scene);
    return () => { clearInterval(timer); context.revert(); };
  }, [animated]);

  return <svg ref={scene} className="animated-menu-scene" viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <radialGradient id="lamp-halo"><stop stopColor="#fff6b2" stopOpacity="0.8" /><stop offset="0.3" stopColor="#ffda6a" stopOpacity="0.3" /><stop offset="1" stopColor="#ffda6a" stopOpacity="0" /></radialGradient>
      <linearGradient id="lamp-beam" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff2ad" stopOpacity="0.28" /><stop offset="1" stopColor="#ffe099" stopOpacity="0" /></linearGradient>
      <clipPath id="curly-hair"><path d="M655 530 Q640 495 682 488 Q677 460 713 480 Q733 455 755 478 Q790 455 806 488 Q840 480 856 515 L867 559 L844 601 L819 635 L780 650 L737 635 L701 620 L671 600 L650 565Z" /></clipPath>
      <clipPath id="long-hair"><path d="M979 668 Q1040 691 1114 672 L1139 705 Q1197 749 1190 790 L1154 841 L1142 877 L1120 851 L1115 825 Q1065 853 1006 834 L960 811 L940 785 L965 739Z" /></clipPath>
      <clipPath id="blue-hair"><path d="M1312 596 Q1318 551 1387 548 Q1451 535 1486 587 L1502 641 L1520 683 L1504 713 L1473 729 L1443 720 L1411 732 L1382 724 L1350 730 L1310 711 L1323 678 L1310 653Z" /></clipPath>
    </defs>
    <image href={artwork} width="1672" height="941" />
    <g clipPath="url(#curly-hair)"><image className="hair-curly" href={artwork} width="1672" height="941" /></g>
    <g clipPath="url(#long-hair)"><image className="hair-long" href={artwork} width="1672" height="941" /></g>
    <g clipPath="url(#blue-hair)"><image className="hair-blue" href={artwork} width="1672" height="941" /></g>
    {/* A base escura cobre a lâmpada acesa na foto para que ela realmente apague. */}
    <ellipse cx="877" cy="106" rx="25" ry="5" fill="#625636" />
    <g className="street-light">
      <path d="M860 109 L894 109 L997 440 L757 440Z" fill="url(#lamp-beam)" />
      <ellipse cx="877" cy="109" rx="115" ry="82" fill="url(#lamp-halo)" />
      <ellipse cx="877" cy="106" rx="25" ry="5" fill="#ffffdf" />
    </g>
    <g className="shelter-light">
      <ellipse cx="1494" cy="295" rx="94" ry="46" fill="url(#lamp-halo)" transform="rotate(-11 1494 295)" />
    </g>
    <ellipse className="bus-headlight" cx="1000" cy="573" rx="35" ry="26" fill="url(#lamp-halo)" />
    <ellipse className="bus-headlight" cx="1173" cy="574" rx="32" ry="24" fill="url(#lamp-halo)" />
    <g transform="translate(1021 401) skewY(2)">
      <rect width="135" height="29" rx="3" fill="#101b28" />
      <text x="67.5" y="19" textAnchor="middle" fill="#ffd36e" fontFamily="monospace" fontSize="13" fontWeight="bold" letterSpacing="0.3">{destinations[destination]}</text>
    </g>
    <g fill="none" stroke="#d8faff" strokeWidth="2" strokeLinecap="round">
      <path className="wifi-wave" d="M747 106 Q752 101 757 106" />
      <path className="wifi-wave" d="M742 99 Q752 90 762 99" />
      <path className="wifi-wave" d="M736 91 Q752 77 768 91" />
    </g>
    {Array.from({ length: 12 }, (_, index) => <g key={index} className="wind-leaf" opacity="0">
      <g transform={`scale(${0.6 + (index % 4) * 0.23})`}>
        <path d="M-13 0 Q-2 -13 15 -3 Q7 13 -13 0Z" fill={['#b9cc45', '#d8bb53', '#6f9f43'][index % 3]} />
        <path d="M-15 2 L12 -2" stroke="#536b31" strokeWidth="1" />
      </g>
    </g>)}
  </svg>;
}
