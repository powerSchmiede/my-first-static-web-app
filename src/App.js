import React from 'react';
import './App.css';

function Glow({ id, cx, cy, r, color, opacity }) {
  return (
    <>
      <defs>
        <radialGradient id={id} cx={cx} cy={cy} r={r}>
          <stop offset="0" stopColor={color} stopOpacity={opacity} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="220" height="200" fill={`url(#${id})`} />
    </>
  );
}

const RED = '#C8102E';
const BLUE = '#3B6FD9';

const tiles = [
  {
    title: 'Support Apps',
    icon: 'M4 14v-2a8 8 0 0 1 16 0v2 M4 14h3v5H5a1 1 0 0 1-1-1z M20 14h-3v5h2a1 1 0 0 0 1-1z M17 19c0 1.5-2 2-5 2',
    art: (
      <>
        <Glow id="g1" cx="50%" cy="50%" r="50%" color={RED} opacity=".35" />
        <g fill="none" stroke="#FFFFFF" strokeOpacity=".08">
          {[40, 60, 80, 100, 120].map(r => <circle key={r} cx="110" cy="100" r={r} />)}
        </g>
      </>
    ),
  },
  {
    title: 'Marketingvorlagen',
    icon: 'M4 4h16v16H4z M4 9h16 M9 9v11',
    art: (
      <>
        <Glow id="g2" cx="100%" cy="0%" r="80%" color={RED} opacity=".3" />
        <g stroke="#FFFFFF" strokeOpacity=".05">
          <path d="M20 0V200 M40 0V200 M60 0V200 M80 0V200 M100 0V200 M120 0V200 M140 0V200 M160 0V200 M180 0V200 M200 0V200" />
          <path d="M0 20H220 M0 40H220 M0 60H220 M0 80H220 M0 100H220 M0 120H220 M0 140H220 M0 160H220 M0 180H220" />
        </g>
        <g stroke="#FFFFFF" strokeOpacity=".14" strokeDasharray="4 4">
          <path d="M40 0V200 M180 0V200 M0 40H220 M0 160H220" />
        </g>
      </>
    ),
  },
  {
    title: 'GKK AI-Land',
    icon: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
    art: (
      <>
        <Glow id="g3" cx="50%" cy="50%" r="55%" color={BLUE} opacity=".4" />
        <g stroke="#8FB0FF" strokeOpacity=".16" fill="none">
          <path d="M20 30L60 20L95 45L150 25L200 40 M20 30L30 95L70 125L120 160L160 150L205 160 M95 45L30 95 M150 25L185 105L205 160 M60 20L95 45 M70 125L40 170L120 160 M185 105L160 150" />
        </g>
        <g fill="#8FB0FF" fillOpacity=".35">
          {[[20, 30, 2.5], [60, 20, 2], [95, 45, 2.5], [150, 25, 2], [200, 40, 2.5], [30, 95, 2], [70, 125, 2.5], [185, 105, 2], [205, 160, 2.5], [40, 170, 2], [120, 160, 2.5], [160, 150, 2]]
            .map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
        </g>
      </>
    ),
  },
  {
    title: 'LevelUP',
    icon: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
    art: (
      <>
        <Glow id="g4" cx="100%" cy="0%" r="90%" color={RED} opacity=".35" />
        <g fill="#FFFFFF" fillOpacity=".06">
          {[20, 32, 46, 62, 80, 100, 122, 146, 172, 200].map((h, i) =>
            <rect key={i} x={8 + i * 22} y={200 - h} width="14" height={h} />)}
        </g>
      </>
    ),
  },
  {
    title: 'Onboarding',
    icon: 'M3 4h18 M5 4v10h14V4 M12 14v3 M8 21l4-4 4 4',
    art: (
      <>
        <Glow id="g5" cx="0%" cy="100%" r="90%" color={RED} opacity=".35" />
        <path d="M5 195 C 50 175, 40 130, 80 135 S 140 110, 150 80 S 190 40, 215 15" fill="none" stroke="#FFFFFF" strokeOpacity=".22" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" />
        <g fill="none" stroke="#FFFFFF" strokeOpacity=".3">
          <circle cx="80" cy="135" r="5" /><circle cx="150" cy="80" r="5" /><circle cx="215" cy="15" r="5" />
        </g>
      </>
    ),
  },
  {
    title: 'Translation Services',
    icon: 'M4 5h8 M8 3v2 M6 5c0 4 3 7 6 8 M10 5c0 3-2 6-5 8 M13 21l4-9 4 9 M14.5 18h5',
    art: (
      <>
        <Glow id="g6" cx="50%" cy="50%" r="55%" color={BLUE} opacity=".3" />
        <g fill="#FFFFFF" fillOpacity=".08" fontFamily="Georgia, serif">
          {[[14, 42, 30, 'A'], [70, 30, 22, 'Ж'], [150, 40, 28, '中'], [196, 80, 20, 'Ω'], [18, 120, 24, 'あ'], [170, 150, 30, 'ع'], [40, 185, 20, 'ß'], [110, 190, 24, '한'], [198, 190, 18, 'é']]
            .map(([x, y, size, ch]) => <text key={ch} x={x} y={y} fontSize={size}>{ch}</text>)}
        </g>
      </>
    ),
  },
  {
    title: 'Copilot Chat',
    icon: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
    art: (
      <>
        <Glow id="g7a" cx="30%" cy="35%" r="45%" color="#2F7BF5" opacity=".45" />
        <Glow id="g7b" cx="70%" cy="40%" r="45%" color="#9B5DE5" opacity=".4" />
        <Glow id="g7c" cx="50%" cy="75%" r="45%" color="#22C39A" opacity=".35" />
      </>
    ),
  },
  {
    title: 'Otto Schmidt Answers',
    icon: 'M14 3H6v18h12V7z M14 3v4h4 M9 13h6 M9 17h4',
    art: (
      <>
        <Glow id="g8" cx="100%" cy="100%" r="90%" color={BLUE} opacity=".35" />
        <g stroke="#FFFFFF" strokeOpacity=".06" strokeWidth="3" strokeLinecap="round">
          <path d="M20 24H150 M20 40H190 M20 56H120 M20 72H170 M20 88H140 M20 104H195 M20 120H110 M20 136H175 M20 152H150 M20 168H185 M20 184H130" />
        </g>
        <text x="150" y="80" fontSize="80" fontFamily="Georgia, serif" fill="#FFFFFF" fillOpacity=".07">§</text>
      </>
    ),
  },
  {
    title: 'GKK Team',
    icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3 3-5 6-5s6 2 6 5 M16 5a3 3 0 0 1 0 6 M18 15c2 .5 3 2 3 5',
    art: (
      <>
        <Glow id="g9" cx="50%" cy="50%" r="55%" color={RED} opacity=".3" />
        <g stroke="#FFFFFF" strokeOpacity=".1" fill="none">
          <path d="M110 100L25 30 M110 100L70 12 M110 100L195 25 M110 100L15 130 M110 100L205 135 M110 100L110 195 M110 100L165 185 M110 100L50 185" />
          <path d="M25 30L70 12L195 25 M205 135L165 185L110 195L50 185L15 130" />
        </g>
        <g fill="#FFFFFF" fillOpacity=".25">
          {[[25, 30], [70, 12], [195, 25], [15, 130], [205, 135], [110, 195], [165, 185], [50, 185]]
            .map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" />)}
        </g>
      </>
    ),
  },
  {
    title: 'Schweitzer',
    icon: 'M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13',
    art: (
      <>
        <Glow id="g10" cx="50%" cy="0%" r="80%" color={BLUE} opacity=".3" />
        <g fill="#FFFFFF" fillOpacity=".06">
          {[[6, 130, 16], [24, 118, 12], [38, 140, 20], [60, 124, 14], [76, 146, 10], [88, 120, 18], [108, 136, 14], [124, 116, 16], [142, 142, 12], [156, 126, 20], [178, 138, 14], [194, 120, 18]]
            .map(([x, y, w]) => <rect key={x} x={x} y={y} width={w} height={200 - y} />)}
        </g>
        <path d="M0 200H220" stroke="#FFFFFF" strokeOpacity=".12" />
      </>
    ),
  },
  {
    title: 'KI-Bild-Check',
    href: '/tools/ki-bild-check/index.html',
    icon: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5 M15.5 6.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z',
    art: (
      <>
        <Glow id="g11a" cx="20%" cy="30%" r="55%" color="#355BAA" opacity=".45" />
        <Glow id="g11b" cx="85%" cy="80%" r="55%" color="#B11B6A" opacity=".4" />
        <g stroke="#FFFFFF" strokeOpacity=".07">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => <rect key={i} x={10 + i * 22} y={10 + (i % 2) * 22} width="12" height="12" fill="none" />)}
        </g>
      </>
    ),
  },
];

function Tile({ title, href, icon, art }) {
  const content = (
    <>
      <div className="tile-art">
        <svg className="tile-bg" width="100%" height="100%" viewBox="0 0 220 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {art}
        </svg>
        <div className="tile-icon">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={icon} />
          </svg>
        </div>
      </div>
      <div className="tile-title">
        {title}
        {!href && <span className="tile-soon">Demnächst</span>}
      </div>
    </>
  );

  return href
    ? <a className="tile" href={href}>{content}</a>
    : <div className="tile tile-disabled" aria-disabled="true">{content}</div>;
}

function App() {
  return (
    <main className="tiles">
      {tiles.map(tile => <Tile key={tile.title} {...tile} />)}
    </main>
  );
}

export default App;
