import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { init, dispose } from '../battleship3d/main';

export function Battleship3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const result = init(container);
    cleanupRef.current = result.dispose;

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      } else {
        dispose();
      }
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8, zIndex: 10 }}>
        <Link
          to="/play"
          style={{
            padding: '8px 16px',
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            borderRadius: 8,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 500
          }}
        >
          2D Game
        </Link>
        <Link
          to="/play3d"
          style={{
            padding: '8px 16px',
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            borderRadius: 8,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 500
          }}
        >
          3D Two-Player
        </Link>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.6)',
          color: 'white',
          borderRadius: 8,
          fontSize: 12,
          zIndex: 10
        }}
      >
        Drag ships from dock (left) onto your grid. Toggle orientation, then attack.
      </div>
    </div>
  );
}
