import { FRESHNESS } from '../core/layer.js';
import { fetchJson } from '../core/net.js';
import { PointLayer } from './pointLayer.js';

const WINDOW_DAYS = 30;

export class LaunchLayer extends PointLayer {
  constructor() {
    super({
      id: 'launches',
      name: 'Launches',
      short: 'LCH',
      kind: 'launch',
      color: '#ffd93c',
      hotkey: '7',
      cadenceMs: 30 * 60_000,
      iconSize: 26,
      groundClamped: true,
      attribution: { label: 'The Space Devs — Launch Library 2', url: 'https://thespacedevs.com/llapi' },
      note: 'Pad locations are exact; launch times slip constantly. Windows shown are the provider’s latest published estimate, not a commitment.',
    });
  }

  async fetchPoints(ctx, signal) {
    const [upcoming, previous] = await Promise.all([
      fetchJson('/api/launches?mode=upcoming&limit=40', { signal, timeoutMs: 20_000 }),
      fetchJson('/api/launches?mode=previous&limit=25', { signal, timeoutMs: 20_000 }),
    ]);

    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
    const rows = [...(upcoming.results ?? []), ...(previous.results ?? [])];

    const points = rows
      .map((l) => {
        const pad = l.pad ?? {};
        const lat = Number(pad.latitude);
        const lon = Number(pad.longitude);
        const t = Date.parse(l.net ?? l.window_start ?? '');
        const future = t > Date.now();
        return {
          id: l.id,
          label: l.name?.split('|')?.[0]?.trim() ?? l.name,
          sub: pad.name ?? '',
          lat,
          lon,
          color: future ? '#ffd93c' : '#8a9a97',
          scale: future ? 1.15 : 0.8,
          meta: {
            mission: l.mission?.name ?? null,
            missionType: l.mission?.type ?? null,
            orbit: l.mission?.orbit?.name ?? null,
            provider: l.launch_service_provider?.name ?? null,
            vehicle: l.rocket?.configuration?.full_name ?? null,
            pad: pad.name ?? null,
            location: pad.location?.name ?? null,
            net: l.net ?? null,
            status: l.status?.abbrev ?? l.status?.name ?? null,
            statusDescription: l.status?.description ?? null,
            webcast: l.webcast_live ?? false,
            url: l.url ?? null,
          },
          fixAt: Number.isFinite(t) ? t : Date.now(),
        };
      })
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.fixAt > cutoff);

    const next = points.filter((p) => p.fixAt > Date.now()).sort((a, b) => a.fixAt - b.fixAt)[0];
    return {
      points,
      state: FRESHNESS.LIVE,
      note: next ? `next: ${next.label} in ${Math.round((next.fixAt - Date.now()) / 3_600_000)}h` : `${points.length} pads`,
    };
  }
}
