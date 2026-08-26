import { WebSocketServer, WebSocket } from 'ws';

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const RESUBSCRIBE_DEBOUNCE_MS = 1200;
const RECONNECT_MS = 6000;

const inBox = (lat, lon, b) => lat >= b[0][0] && lat <= b[1][0] && lon >= b[0][1] && lon <= b[1][1];

function unionBox(boxes) {
  const flat = boxes.flat();
  if (!flat.length) return null;
  return [
    [Math.min(...flat.map((p) => p[0])), Math.min(...flat.map((p) => p[1]))],
    [Math.max(...flat.map((p) => p[0])), Math.max(...flat.map((p) => p[1]))],
  ];
}

/**
 * AISStream allows one live connection per key, so the proxy holds exactly one
 * upstream socket and multiplexes it: browser clients subscribe to their own
 * bounding box, the relay subscribes upstream to the union, and each report is
 * fanned out only to the clients whose box actually contains it.
 *
 * The key never leaves this process.
 */
export function attachAisRelay(server, { apiKey, path = '/api/ais', log = console }) {
  const wss = new WebSocketServer({ server, path });
  const clients = new Map(); // ws -> boxes
  let up = null;
  let upTimer = null;
  let resubTimer = null;
  let currentUnion = null;
  const staticById = new Map(); // MMSI -> last static report, so names survive

  function broadcastStatus(text, level = 'error') {
    for (const ws of clients.keys()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: level, message: text }));
    }
  }

  function desiredUnion() {
    return unionBox([...clients.values()].flat());
  }

  function scheduleResubscribe() {
    clearTimeout(resubTimer);
    resubTimer = setTimeout(() => {
      const next = desiredUnion();
      if (!next) {
        closeUpstream();
        return;
      }
      if (JSON.stringify(next) === JSON.stringify(currentUnion) && up?.readyState === WebSocket.OPEN) return;
      currentUnion = next;
      // AISStream applies the bounding box at subscribe time only, so a new
      // area of interest means a fresh connection.
      closeUpstream();
      openUpstream();
    }, RESUBSCRIBE_DEBOUNCE_MS);
  }

  function closeUpstream() {
    clearTimeout(upTimer);
    if (up) {
      up.removeAllListeners();
      try {
        up.close();
      } catch {
        /* already gone */
      }
      up = null;
    }
  }

  function openUpstream() {
    if (!currentUnion || !clients.size) return;
    const socket = new WebSocket(AIS_URL);
    up = socket;

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [currentUnion],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        }),
      );
      log.info?.(`[ais] subscribed ${JSON.stringify(currentUnion)}`);
    });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.error) {
        broadcastStatus(`AISStream: ${msg.error}`);
        return;
      }
      const meta = msg.MetaData ?? {};
      const mmsi = meta.MMSI ?? meta.MMSI_String;
      if (!mmsi) return;

      if (msg.MessageType === 'ShipStaticData') {
        const s = msg.Message?.ShipStaticData ?? {};
        staticById.set(String(mmsi), {
          name: s.Name ?? meta.ShipName,
          callSign: s.CallSign,
          imo: s.ImoNumber,
          shipType: s.Type,
          destination: s.Destination,
          draught: s.MaximumStaticDraught,
        });
        return;
      }

      const p = msg.Message?.PositionReport;
      if (!p) return;
      const lat = Number(p.Latitude);
      const lon = Number(p.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const known = staticById.get(String(mmsi)) ?? {};
      const payload = JSON.stringify({
        type: 'position',
        data: {
          mmsi: String(mmsi),
          lat,
          lon,
          // 511 is the AIS "heading not available" sentinel.
          cog: Number(p.Cog) < 360 ? Number(p.Cog) : null,
          heading: Number(p.TrueHeading) < 360 ? Number(p.TrueHeading) : null,
          sog: Number(p.Sog) < 102.3 ? Number(p.Sog) : null,
          navStatus: p.NavigationalStatus ?? null,
          name: known.name ?? meta.ShipName ?? null,
          callSign: known.callSign ?? null,
          imo: known.imo ?? null,
          shipType: known.shipType ?? null,
          destination: known.destination ?? null,
          draught: known.draught ?? null,
          at: Date.parse(meta.time_utc ?? '') || Date.now(),
        },
      });

      for (const [ws, boxes] of clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (boxes.some((b) => inBox(lat, lon, b))) ws.send(payload);
      }
    });

    socket.on('close', () => {
      if (up !== socket) return;
      up = null;
      if (clients.size) upTimer = setTimeout(openUpstream, RECONNECT_MS);
    });

    socket.on('error', (err) => {
      log.warn?.(`[ais] upstream error: ${err.message}`);
      broadcastStatus('AIS upstream error — retrying');
    });
  }

  wss.on('connection', (ws) => {
    if (!apiKey) {
      ws.send(JSON.stringify({ type: 'error', message: 'AISSTREAM_API_KEY is not configured on this server' }));
      ws.close(1011, 'no key');
      return;
    }
    clients.set(ws, []);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'subscribe' && Array.isArray(msg.boxes)) {
        clients.set(ws, msg.boxes.slice(0, 4));
        scheduleResubscribe();
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      scheduleResubscribe();
    });
  });

  return {
    close() {
      closeUpstream();
      wss.close();
    },
  };
}
