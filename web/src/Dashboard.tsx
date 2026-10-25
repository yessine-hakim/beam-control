import { useState } from 'react';
import { describeLogEntry } from './describeLogEntry';
import type { WireSnapshot } from './types';

interface Props {
  snapshot: WireSnapshot | null;
  onFlyTo: (receiverId: string) => void;
  send: (event: 'drill' | 'liveFeed', payload?: unknown) => Promise<unknown>;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });
const ago = (ms: number | null) => (ms ? `${Math.max(0, Math.round((Date.now() - ms) / 1000))} s ago` : '—');

export function Dashboard({ snapshot, onFlyTo, send }: Props) {
  const [busy, setBusy] = useState(false);
  if (!snapshot) return <aside className="dashboard dashboard--empty">Connecting to Beam Control…</aside>;

  const { receivers, metrics, feed, log } = snapshot;
  const nameOf = (id: string) => receivers.find((r) => r.id === id)?.name ?? id;

  const toggleFeed = async () => {
    setBusy(true);
    await send('liveFeed', { on: !feed.live });
    setBusy(false);
  };

  return (
    <aside className="dashboard" aria-label="Beam Control dashboard">
      <section className="card">
        <h2>Receivers</h2>
        {receivers.map((r) => {
          const pct = r.capacityMW ? (100 * r.deliveredMW) / r.capacityMW : 0;
          return (
            <div className="receiver" key={r.id}>
              <div className="row">
                <span className="receiver__name">{r.name}</span>
                <span className="mono">
                  {Math.round(r.deliveredMW)} / {r.capacityMW} MW
                </span>
              </div>
              <div
                className="meter"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
                aria-label={`${r.name} power delivered`}
              >
                <i style={{ width: `${pct.toFixed(1)}%` }} />
              </div>
              <div className="row sub">
                <span>via {r.servingSatId ?? '—'}</span>
                <button type="button" onClick={() => onFlyTo(r.id)}>
                  Fly to
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>Safety</h2>
        <dl className="metrics">
          <div>
            <dt>Intrusions predicted</dt>
            <dd>{metrics.intrusionsPredicted}</dd>
          </div>
          <div>
            <dt>Handoffs</dt>
            <dd>{metrics.handoffs}</dd>
          </div>
          <div>
            <dt>Throttles</dt>
            <dd>{metrics.throttles}</dd>
          </div>
          <div className={metrics.contacts === 0 ? 'ok' : 'bad'}>
            <dt>Contacts</dt>
            <dd>{metrics.contacts}</dd>
          </div>
          <div className="wide">
            <dt>Uptime this session</dt>
            <dd>{metrics.uptimePct.toFixed(2)} %</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <div className="row">
          <h2>Live traffic</h2>
          <label className="switch">
            <input type="checkbox" checked={feed.live} disabled={busy} onChange={toggleFeed} />
            <span>Live feed</span>
          </label>
        </div>
        {feed.live ? (
          <p className="sub">
            Live flights: {feed.flights} · Satellites: {feed.satellites}
            <br />
            Source: {feed.source ?? '—'} · updated {ago(feed.lastUpdateMs)}
            {feed.remaining !== null ? ` · ${feed.remaining} requests left today` : ''}
          </p>
        ) : (
          <p className="sub">Live feed paused · Satellites: {feed.satellites}</p>
        )}
        {feed.error && <p className="warn">{feed.error}</p>}
      </section>

      <section className="card card--log">
        <h2>Decision log</h2>
        <ol className="log" aria-live="off">
          {[...log].reverse().map((e, i) => (
            <li key={`${e.timeMs}-${e.type}-${i}`}>
              <time>{clock(e.timeMs)}</time> {describeLogEntry(e, nameOf)}
            </li>
          ))}
          {log.length === 0 && <li className="sub">No interventions yet.</li>}
        </ol>
      </section>

      <button type="button" className="drill" onClick={() => send('drill')}>
        Run drill (simulated intruder)
      </button>
    </aside>
  );
}
