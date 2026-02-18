import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { init, dispose } from '../battleship3d/main';

export function Battleship3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    cleanupRef.current = init(container);

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
      <Link
        to="/play"
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '8px 16px',
          background: 'rgba(0,0,0,0.6)',
          color: 'white',
          borderRadius: 8,
          textDecoration: 'none',
          fontSize: 14,
          fontWeight: 500,
          zIndex: 10
        }}
      >
        2D Game
      </Link>
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
