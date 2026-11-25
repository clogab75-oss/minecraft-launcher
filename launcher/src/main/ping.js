// "Server List Ping" Minecraft : joueurs en ligne.
const net = require('net');
const dns = require('dns/promises');

function varInt(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function readVarInt(buf, offset) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const b = buf[offset + i];
    value |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return { value, next: offset + i + 1 };
  }
  throw new Error('VarInt invalide');
}

const packet = (...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([varInt(body.length), body]);
};

async function ping(host, port = 25565, timeout = 5000) {
  let target = { host, port };
  if (port === 25565 && !net.isIP(host)) {
    const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`).catch(() => []);
    if (srv[0]) target = { host: srv[0].name, port: srv[0].port };
  }
  return new Promise((resolve) => {
    const socket = net.connect(target);
    let data = Buffer.alloc(0);
    const end = (result) => { clearTimeout(timer); socket.destroy(); resolve(result); };
    const timer = setTimeout(() => end({ online: false }), timeout);
    socket.on('error', () => end({ online: false }));
    socket.on('close', () => end({ online: false }));
    socket.on('connect', () => {
      const name = Buffer.from(host);
      const p = Buffer.alloc(2);
      p.writeUInt16BE(port);
      socket.write(packet(varInt(0), varInt(0x7fffffff), varInt(name.length), name, p, varInt(1)));
      socket.write(packet(varInt(0)));
    });
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 1e6) return end({ online: false });
      try {
        const length = readVarInt(data, 0);
        if (!length || data.length < length.next + length.value) return;
        const id = readVarInt(data, length.next);
        const size = readVarInt(data, id.next);
        const status = JSON.parse(data.subarray(size.next, size.next + size.value).toString('utf8'));
        end({ online: true, players: status.players?.online ?? 0, max: status.players?.max ?? 0 });
      } catch { end({ online: false }); }
    });
  });
}

module.exports = { ping };
