export function TopBar({ connected }: { connected: boolean }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          ⚡
        </span>
        <strong>BEAM CONTROL</strong>
        <span className="brand__tag">Air traffic control for space-based solar power</span>
      </div>
      <span className="badge">SIMULATED POWER CONSTELLATION · LIVE TRAFFIC</span>
      <span className={`status ${connected ? 'status--on' : ''}`}>
        <i aria-hidden="true" /> {connected ? 'Connected' : 'Reconnecting…'}
      </span>
    </header>
  );
}
