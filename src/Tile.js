import React from 'react';
import { backgrounds, icons, DEFAULT_BACKGROUND, DEFAULT_ICON } from './designs';

export function TileArt({ uid, icon, background, iconSize = 60, className = '' }) {
  const bg = backgrounds[background] || backgrounds[DEFAULT_BACKGROUND];
  const ic = icons[icon] || icons[DEFAULT_ICON];
  return (
    <div className={`tile-art ${className}`}>
      <svg className="tile-bg" width="100%" height="100%" viewBox="0 0 220 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {bg.render(uid)}
      </svg>
      {icon !== null && (
        <div className="tile-icon">
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={ic.path} />
          </svg>
        </div>
      )}
    </div>
  );
}

export function appHref(app) {
  if (app.type === 'html') return `/api/apps/${encodeURIComponent(app.id)}/html`;
  if (app.type === 'link') return app.url;
  return null;
}

export default function Tile({ app, uid }) {
  const href = appHref(app);
  const external = !!href && /^https?:\/\//i.test(href);
  const content = (
    <>
      <TileArt uid={uid || `tile-${app.id}`} icon={app.icon} background={app.background} />
      <div className="tile-title">
        <span>{app.title}</span>
        {!href && <span className="tile-soon">Demnächst</span>}
      </div>
    </>
  );

  if (!href) return <div className="tile tile-disabled" aria-disabled="true">{content}</div>;
  return (
    <a className="tile" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {content}
    </a>
  );
}
